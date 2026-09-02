import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const decodeKey = (raw: string, aliases: Map<string, string>) => {
  const value = raw.trim();
  if (value.startsWith('*')) return aliases.get(value.slice(1)) ?? value;
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const unquoteRef = (raw: string) => {
  const value = raw.trim().replace(/[,}]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const splitTopLevelEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const collectBlockScalarAnchoredKeyRefs = (workflow: string) => {
  const refs: string[] = [];
  const aliases = new Map<string, string>();
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const blockAnchor = line.match(/^\s*[^:#]+:\s*&([A-Za-z0-9_-]+)\s+[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/);
    if (blockAnchor) {
      const body: string[] = [];
      let child = index + 1;
      for (; child < lines.length; child += 1) {
        const childLine = lines[child];
        const childTrimmed = childLine.trim();
        const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
        if (childTrimmed && childIndent <= indent) break;
        if (childTrimmed && !childTrimmed.startsWith('#')) body.push(childTrimmed);
      }
      if (body.length) aliases.set(blockAnchor[1], body.join(' ').trim());
      index = child - 1;
      continue;
    }

    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent === null) continue;
    if (indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }

    const step = line.match(/^\s*-\s+(?:(?:&|!)[^\s{}]+\s+)+\{([\s\S]*)\}\s*(?:#.*)?$/);
    if (!step) continue;
    for (const entry of splitTopLevelEntries(step[1])) {
      const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z0-9_-]+|[^:\s]+))\s*:\s*(.+?)\s*$/);
      if (mapping && decodeKey(mapping[1], aliases) === 'uses') refs.push(unquoteRef(mapping[2]));
    }
  }
  return refs;
};

const expectImmutableBlockScalarAnchoredKeyRefs = (workflow: string, source: string) => {
  for (const ref of collectBlockScalarAnchoredKeyRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('GitHub workflow block-scalar anchored action-key pinning', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectImmutableBlockScalarAnchoredKeyRefs(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects mutable refs whose uses key comes from a block-scalar anchor', () => {
    const unsafe = [
      'ACTION_KEY: &use-key >-',
      '  uses',
      'jobs:',
      '  build:',
      '    steps:',
      '      - &action { *use-key: actions/checkout@v4 }',
    ].join('\n');
    expect(collectBlockScalarAnchoredKeyRefs(unsafe)).toEqual(['actions/checkout@v4']);
    expect(() => expectImmutableBlockScalarAnchoredKeyRefs(unsafe, 'block-anchor.yml')).toThrow();
  });

  it('accepts immutable refs through block-scalar anchored uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'ACTION_KEY: &use-key >-',
      '  uses',
      'jobs:',
      '  build:',
      '    steps:',
      `      - &action { *use-key: actions/checkout@${sha} }`,
    ].join('\n');
    expect(collectBlockScalarAnchoredKeyRefs(safe)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableBlockScalarAnchoredKeyRefs(safe, 'block-anchor.yml');
  });

  it('does not treat unrelated block-scalar anchors as uses keys', () => {
    const safe = [
      'ACTION_KEY: &name-key >-',
      '  name',
      'jobs:',
      '  build:',
      '    steps:',
      '      - &action { *name-key: actions/checkout@v4, run: echo safe }',
    ].join('\n');
    expect(collectBlockScalarAnchoredKeyRefs(safe)).toEqual([]);
  });
});
