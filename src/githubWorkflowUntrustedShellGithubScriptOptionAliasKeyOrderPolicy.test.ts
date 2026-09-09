import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/;

const containsUntrustedPayloadText = (value: string) => {
  const normalized = value
    .replace(/\?\./g, '.')
    .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectStepMappings = (workflow: string) => {
  const lines = workflow.split('\n');
  const steps: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+\S/);
    if (!start) continue;
    const stepIndent = start[1].length;
    const step = [lines[index]];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const raw = lines[cursor];
      const trimmed = raw.trim();
      if (trimmed && /^-\s+/.test(trimmed) && indentOf(raw) === stepIndent) break;
      if (trimmed && indentOf(raw) < stepIndent) break;
      step.push(raw);
      cursor += 1;
    }
    steps.push(step);
    index = cursor - 1;
  }
  return steps;
};

const extractScript = (step: string[]) => {
  for (let index = 0; index < step.length; index += 1) {
    const match = step[index].match(/^\s*script\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value && !blockHeader.test(value)) return value;
    const scriptIndent = indentOf(step[index]);
    const body: string[] = [];
    for (let cursor = index + 1; cursor < step.length; cursor += 1) {
      const raw = step[cursor];
      if (raw.trim() && indentOf(raw) <= scriptIndent) break;
      if (raw.trim()) body.push(raw.trim());
    }
    return body.join('\n');
  }
  return '';
};

const hasAliasedShellExecution = (script: string) => {
  const shellAliases = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[^;\n]*\})/g)) {
    if (/\bshell\s*:\s*(?:true|(['"`])[^'"`]+\2)/.test(match[2])) shellAliases.add(match[1]);
  }
  for (const match of script.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*([^,]+),\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    if (!shellAliases.has(match[2])) continue;
    if (containsUntrustedPayloadText(match[1])) return true;
  }
  return false;
};

const expectNoAliasedShellExecution = (workflow: string, source: string) => {
  for (const step of collectStepMappings(workflow)) {
    const mapping = step.join('\n');
    if (!/^\s*-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+/im.test(mapping)) continue;
    const script = extractScript(step);
    expect(
      hasAliasedShellExecution(script),
      `${source}: GitHub Script executes attacker-controlled event text through aliased shell options`,
    ).toBe(false);
  }
};

describe('GitHub Script aliased shell option key-order trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoAliasedShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects aliased shell execution when script precedes uses', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - with:',
      '          script: |',
      "            const options = { shell: '/bin/bash' };",
      '            require(\'node:child_process\').execFileSync(context.payload.comment.body, [], options);',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');
    expect(() => expectNoAliasedShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows repository-owned commands when script precedes uses', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - with:',
      '          script: |',
      '            const options = { shell: true };',
      "            require('node:child_process').spawnSync('echo safe', [], options);",
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');
    expectNoAliasedShellExecution(safe, 'safe.yml');
  });
});
