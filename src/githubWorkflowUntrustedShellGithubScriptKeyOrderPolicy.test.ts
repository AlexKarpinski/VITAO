import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const hasUntrustedExecution = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const [, name, expression] = declaration;
      if (tainted.has(name)) continue;
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPayloadText(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }

  const sink = /\b(?:exec|execSync)\s*(?:\?\.)?\(\s*([^,)\n]+)/g;
  for (let match = sink.exec(script); match; match = sink.exec(script)) {
    const argument = match[1];
    if (containsUntrustedPayloadText(argument)) return true;
    if ([...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(argument))) {
      return true;
    }
  }
  return false;
};

const collectStepBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const steps: string[][] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+\S/);
    if (!start) continue;
    const stepIndent = start[1].length;
    const block = [lines[index]];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (/^\s*-\s+\S/.test(line) && indentOf(line) === stepIndent) break;
      if (line.trim() && indentOf(line) < stepIndent) break;
      block.push(line);
    }
    steps.push(block);
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
      const line = step[cursor];
      if (line.trim() && indentOf(line) <= scriptIndent) break;
      if (line.trim()) body.push(line.trim());
    }
    return body.join('\n');
  }
  return null;
};

const expectNoUntrustedGithubScriptExecution = (workflow: string, source: string) => {
  for (const step of collectStepBlocks(workflow)) {
    const text = step.join('\n');
    if (!/\buses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?/.test(text)) continue;
    const script = extractScript(step);
    if (!script) continue;
    expect(hasUntrustedExecution(script), `${source}: GitHub Script executes attacker-controlled event text`).toBe(false);
  }
};

describe('GitHub Script mapping-key-order trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedGithubScriptExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled execution when script appears before uses', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - with:',
      '          script: |',
      '            const command = context.payload.comment.body;',
      "            require('node:child_process').execSync(command);",
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptExecution(unsafe, 'script-before-uses.yml')).toThrow();
  });

  it('allows repository-owned commands when script appears before uses', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - with:',
      '          script: |',
      "            require('node:child_process').execSync('npm test');",
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');
    expectNoUntrustedGithubScriptExecution(safe, 'script-before-uses-safe.yml');
  });
});
