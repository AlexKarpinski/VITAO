import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const blockScalarHeader = /:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const joinDoubleQuotedContinuations = (lines: string[], start: number) => {
  let value = lines[start].trim();
  let end = start;
  while (value.startsWith('"') && !/(?<!\\)"\s*(?:#.*)?$/.test(value) && end + 1 < lines.length) {
    end += 1;
    const previousEndsWithContinuation = /\\\s*$/.test(value);
    value = previousEndsWithContinuation
      ? value.replace(/\\\s*$/, '') + lines[end].trimStart()
      : `${value} ${lines[end].trimStart()}`;
  }
  return { value, end };
};

const decodeQuoted = (raw: string) => {
  const value = raw.trim().replace(/\s+#.*$/, '').trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const collectAnchoredKeys = (workflow: string) => {
  const aliases = new Map<string, string>();
  const lines = workflow.split('\n');
  let blockScalarIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const indent = indentOf(rawLine);
    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (blockScalarHeader.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }
    const match = trimmed.match(/^[^:#]+:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)$/);
    if (!match) continue;
    let rawValue = match[2];
    if (rawValue.trimStart().startsWith('"')) {
      const joined = joinDoubleQuotedContinuations([rawValue, ...lines.slice(index + 1)], 0);
      rawValue = joined.value;
      index += joined.end;
    }
    aliases.set(match[1], decodeQuoted(rawValue));
  }
  return aliases;
};

const collectAliasedUsesRefs = (workflow: string) => {
  const refs: string[] = [];
  const aliases = collectAnchoredKeys(workflow);
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;
  for (const line of lines) {
    const indent = indentOf(line);
    const trimmed = line.trim();
    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (blockScalarHeader.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }
    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) { stepsIndent = indent; continue; }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) { stepsIndent = null; continue; }
    const flow = trimmed.match(/^-\s+(?:(?:&|!)[^\s{}]+\s+)*\{(.+)\}\s*$/);
    if (!flow) continue;
    for (const entry of flow[1].split(',')) {
      const mapping = entry.match(/^\s*(\*[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([^,}]+)\s*$/);
      if (!mapping) continue;
      const key = aliases.get(mapping[1].slice(1));
      if (key === 'uses') refs.push(decodeQuoted(mapping[2]));
    }
  }
  return refs;
};

const expectImmutableAliasedUses = (workflow: string, source: string) => {
  for (const ref of collectAliasedUsesRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('multiline quoted anchored action keys', () => {
  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableAliasedUses(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable action behind a multiline quoted uses-key anchor', () => {
    const unsafe = [
      'name: &uses-key "us\\',
      '  es"',
      'steps:',
      '  - &checkout { *uses-key: actions/checkout@v4 }',
    ].join('\n');
    expect(collectAliasedUsesRefs(unsafe)).toEqual(['actions/checkout@v4']);
    expect(() => expectImmutableAliasedUses(unsafe, 'multiline-key.yml')).toThrow();
  });

  it('accepts the same multiline anchored key with an immutable action ref', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'name: &uses-key "us\\',
      '  es"',
      'steps:',
      `  - &checkout { *uses-key: actions/checkout@${sha} }`,
    ].join('\n');
    expect(collectAliasedUsesRefs(safe)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableAliasedUses(safe, 'multiline-key-pinned.yml');
  });

  it('ignores anchored action examples inside block scalars', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - run: |',
      '          x-key: &uses-key "uses"',
      '          steps:',
      '            - { *uses-key: actions/checkout@v4 }',
      '      - run: echo safe',
    ].join('\n');
    expect(collectAliasedUsesRefs(safe)).toEqual([]);
    expectImmutableAliasedUses(safe, 'block-scalar-docs.yml');
  });
});
