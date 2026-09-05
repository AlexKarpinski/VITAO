import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^\s*-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"#]+['"]?(?:\s+#.*)?$/i);
    if (!uses) continue;
    const stepIndent = indentOf(lines[index]);
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].replace(/\s+#.*$/, '').trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        if (bodyRaw.trim() && indentOf(bodyRaw) <= indent) break;
        if (bodyRaw.trim()) body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_$][\w$-]*)['"]\s*\]/g, '.$1');

const untrustedParent = (value: string) => /^(?:context\.payload|github\.event)\.(?:issue|comment|pull_request|review|review_comment|discussion)$/
  .test(normalizeAccess(value.trim()));

const untrustedLeaf = (parent: string, key: string) => {
  const normalized = normalizeAccess(parent.trim());
  const path = `${normalized}.${key}`;
  return /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))$/.test(path);
};

const collectDestructuredTaint = (script: string) => {
  const tainted = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s*\{([^{}]+)\}\s*=\s*([^;\n]+)/g)) {
    const [, bindings, source] = match;
    if (!untrustedParent(source)) continue;
    for (const entry of bindings.split(',')) {
      const [rawKey, rawAlias] = entry.split(':').map((part) => part.trim());
      const key = rawKey.replace(/^['"]|['"]$/g, '');
      const alias = (rawAlias || rawKey).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(alias) && untrustedLeaf(source, key)) tainted.add(alias);
    }
  }
  return tainted;
};

const hasTaintedEval = (script: string) => {
  const tainted = collectDestructuredTaint(script);
  for (const match of script.matchAll(/(?:^|[^\w$])(?:(?:globalThis|global|window|self)\s*(?:\.\s*eval|\[\s*['"]eval['"]\s*\])|eval)\s*\(([^)]+)\)/g)) {
    const argument = match[1].trim();
    if (tainted.has(argument)) return true;
  }
  return false;
};

const expectNoDestructuredEval = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasTaintedEval(script), `${source}: GitHub Script eval executes destructured attacker-controlled text`).toBe(false);
  }
};

describe('GitHub Script destructured eval taint policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoDestructuredEval(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects eval of a destructured comment body', () => {
    const unsafe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      '            const { body } = context.payload.comment;',
      '            eval(body);',
    ].join('\n');
    expect(() => expectNoDestructuredEval(unsafe, 'destructured-eval.yml')).toThrow();
  });

  it('rejects eval of an aliased destructured issue body', () => {
    const unsafe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      '            const { body: code } = context.payload.issue;',
      '            globalThis.eval(code);',
    ].join('\n');
    expect(() => expectNoDestructuredEval(unsafe, 'destructured-alias-eval.yml')).toThrow();
  });

  it('allows destructured payload text when it is handled only as data', () => {
    const safe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      '            const { body } = context.payload.comment;',
      '            core.info(body);',
    ].join('\n');
    expectNoDestructuredEval(safe, 'destructured-data.yml');
  });
});
