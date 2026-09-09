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
  .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedIdentifiers = (script: string) => {
  const assignments = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  const tainted = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, value] of assignments) {
      if (tainted.has(name)) continue;
      const derived = containsUntrustedPayloadText(value)
        || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));
      if (!derived) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const hasTaintedVmScript = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const isTainted = (value: string) => containsUntrustedPayloadText(value)
    || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

  for (const match of script.matchAll(/\bnew\s+(?:(?:require\(\s*['"](?:node:)?vm['"]\s*\)|vm)\s*\.\s*)Script\s*\(([^)]*)\)/g)) {
    const source = match[1].split(',')[0]?.trim() ?? '';
    if (isTainted(source)) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*["']?uses["']?\s*:\s*["']?actions\/github-script@[^\s"']+["']?(?:\s+#.*)?$/i);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*["']?script["']?\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].replace(/\s+#.*$/, '').trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        if (bodyRaw.trim() && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyRaw.trim()) body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoTaintedVmScript = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasTaintedVmScript(script), `${source}: vm.Script compiles attacker-controlled JavaScript`).toBe(false);
  }
};

describe('GitHub Script vm.Script policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoTaintedVmScript(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled vm.Script source', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const vm = require("node:vm");',
      '            new vm.Script(context.payload.comment.body).runInThisContext();',
    ].join('\n');
    expect(() => expectNoTaintedVmScript(unsafe, 'vm-script.yml')).toThrow();
  });

  it('rejects vm.Script source propagated through a local alias', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const code = context.payload.issue.body;',
      '            new require("node:vm").Script(code).runInThisContext();',
    ].join('\n');
    expect(() => expectNoTaintedVmScript(unsafe, 'vm-script-alias.yml')).toThrow();
  });

  it('allows vm.Script with repository-owned constant code', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const vm = require("node:vm");',
      '            new vm.Script("1 + 1").runInThisContext();',
    ].join('\n');
    expectNoTaintedVmScript(safe, 'vm-script-safe.yml');
  });
});
