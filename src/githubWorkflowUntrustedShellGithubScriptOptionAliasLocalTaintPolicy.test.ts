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

const hasAliasedShellExecutionThroughLocal = (script: string) => {
  const shellAliases = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[^;\n]*\})/g)) {
    if (/\bshell\s*:\s*(?:true|(['"`])[^'"`]+\1)/.test(match[2])) shellAliases.add(match[1]);
  }

  const tainted = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
    if (containsUntrustedPayloadText(match[2]) || tainted.has(match[2].trim())) tainted.add(match[1]);
  }

  for (const match of script.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*([^,]+),\s*[^,]+,\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    if (!shellAliases.has(match[2])) continue;
    const command = match[1].trim();
    if (containsUntrustedPayloadText(command) || tainted.has(command)) return true;
  }
  return false;
};

const expectNoAliasedShellLocalTaint = (workflow: string, source: string) => {
  for (const step of collectStepMappings(workflow)) {
    const mapping = step.join('\n');
    if (!/^\s*-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+/im.test(mapping)) continue;
    const script = extractScript(step);
    expect(
      hasAliasedShellExecutionThroughLocal(script),
      `${source}: GitHub Script executes attacker-controlled local text through aliased shell options`,
    ).toBe(false);
  }
};

describe('GitHub Script aliased shell option local-taint trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoAliasedShellLocalTaint(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled commands propagated through a local', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const options = { shell: '/bin/bash' };",
      '            const command = context.payload.comment.body;',
      "            require('node:child_process').execFileSync(command, [], options);",
    ].join('\n');
    expect(() => expectNoAliasedShellLocalTaint(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows repository-owned commands propagated through a local', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const options = { shell: true };',
      "            const command = 'echo safe';",
      "            require('node:child_process').spawnSync(command, [], options);",
    ].join('\n');
    expectNoAliasedShellLocalTaint(safe, 'safe.yml');
  });
});
