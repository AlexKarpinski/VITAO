import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectDestructuredTaint = (script: string) => {
  const tainted = new Set<string>();
  const declarations = script.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^;\n]+)/g);
  for (const declaration of declarations) {
    const fields = declaration[1].split(',');
    const source = declaration[2].trim();
    for (const field of fields) {
      const match = field.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?(?:\s*=.*)?$/);
      if (!match) continue;
      const property = match[1];
      const local = match[2] ?? property;
      if (containsUntrustedPayloadText(`${source}.${property}`)) tainted.add(local);
    }
  }
  return tainted;
};

const hasDestructuredPayloadShellExecution = (script: string) => {
  const tainted = collectDestructuredTaint(script);
  if (tainted.size === 0) return false;
  for (const match of script.matchAll(/\b(?:exec|execSync)\s*\(([^)]+)\)/g)) {
    const command = match[1].split(',')[0] ?? '';
    if ([...tainted].some((name) => new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`).test(command))) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoDestructuredPayloadShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasDestructuredPayloadShellExecution(script),
      `${source}: destructured attacker-controlled GitHub text reaches a shell execution API`,
    ).toBe(false);
  }
};

describe('GitHub Script destructured payload shell boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoDestructuredPayloadShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects destructured comment text passed to execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { body } = context.payload.comment;',
      "            require('node:child_process').execSync(body);",
    ].join('\n');
    expect(() => expectNoDestructuredPayloadShellExecution(unsafe, 'destructured.yml')).toThrow();
  });

  it('rejects aliased destructured comment text passed to exec', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { body: command } = context.payload.comment;',
      "            require('node:child_process').exec(command);",
    ].join('\n');
    expect(() => expectNoDestructuredPayloadShellExecution(unsafe, 'aliased-destructured.yml')).toThrow();
  });

  it('allows destructured non-text metadata beside a constant command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { id } = context.payload.comment;',
      '            core.info(String(id));',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');
    expectNoDestructuredPayloadShellExecution(safe, 'safe-destructured.yml');
  });
});
