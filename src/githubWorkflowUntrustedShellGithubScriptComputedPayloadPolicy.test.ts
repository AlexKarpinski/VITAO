import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const untrustedPayloadPath = /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/;

const foldStaticComputedMembers = (value: string) => {
  let normalized = value.replace(/\?\./g, '.');
  const computedMember = /\[\s*((?:['"`]([A-Za-z_][A-Za-z0-9_-]*)['"`]\s*(?:\+\s*['"`]([A-Za-z_][A-Za-z0-9_-]*)['"`]\s*)*))\]/g;
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(computedMember, (match, expression: string) => {
      if (expression.includes('${')) return match;
      const parts = [...expression.matchAll(/['"`]([A-Za-z_][A-Za-z0-9_-]*)['"`]/g)].map((part) => part[1]);
      return parts.length > 0 ? `.${parts.join('')}` : match;
    });
  }
  return normalized;
};

const containsUntrustedPayloadText = (value: string) => untrustedPayloadPath.test(foldStaticComputedMembers(value));

const collectTaintedIdentifiers = (script: string) => {
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
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPayloadText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const hasComputedPayloadShellExecution = (script: string) => {
  const normalized = foldStaticComputedMembers(script);
  const tainted = collectTaintedIdentifiers(normalized);
  for (const match of normalized.matchAll(/\b(?:exec|execSync)\s*\(\s*([^;\n)]+)/g)) {
    if (containsTaintedValue(match[1], tainted)) return true;
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

const expectNoComputedPayloadShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasComputedPayloadShellExecution(script),
      `${source}: GitHub Script executes attacker-controlled text reached through a computed payload member`,
    ).toBe(false);
  }
};

describe('GitHub Script computed payload member trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoComputedPayloadShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects shell execution through concatenated computed payload members', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload['com' + 'ment'].body);",
    ].join('\n');
    expect(() => expectNoComputedPayloadShellExecution(unsafe, 'computed-payload.yml')).toThrow();
  });

  it('propagates computed payload members through local aliases', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const body = context.payload['pull_' + 'request']['bo' + 'dy'];",
      "            require('node:child_process').exec(body);",
    ].join('\n');
    expect(() => expectNoComputedPayloadShellExecution(unsafe, 'computed-payload-alias.yml')).toThrow();
  });

  it('allows computed payload text when it is only passed as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const body = context.payload['com' + 'ment'].body;",
      '            core.info(body);',
    ].join('\n');
    expectNoComputedPayloadShellExecution(safe, 'computed-payload-safe.yml');
  });
});
