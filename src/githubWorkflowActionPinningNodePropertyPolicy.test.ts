import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const blockScalarHeader = /:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const decodeKey = (raw: string, aliases: Map<string, string>) => {
  const value = raw.trim();
  if (value.startsWith('*')) return aliases.get(value.slice(1)) ?? value;
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const unquote = (raw: string) => {
  const value = raw.trim().replace(/[,}]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
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
    else if (char === ',' && curly === 0 && square === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const collectNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const aliases = new Map<string, string>();
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    if (blockScalarHeader.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    const anchor = trimmed.match(/^(?:[^:#]+):\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/);
    if (anchor) aliases.set(anchor[1], decodeKey(anchor[2], aliases));

    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }

    const entry = line.match(/^\s*-\s+(?:(?:&|!)[^\s{}]+\s+)+\{([\s\S]*)\}\s*$/);
    if (!entry) continue;
    for (const mapping of splitTopLevelEntries(entry[1])) {
      const match = mapping.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|\*[A-Za-z_][A-Za-z0-9_-]*|[^:\s]+))\s*:\s*(.+?)\s*$/);
      if (match && decodeKey(match[1], aliases) === 'uses') refs.push(unquote(match[2]));
    }
  }
  return refs;
};

const expectImmutableNodePropertyStepRefs = (workflow: string, source: string) => {
  for (const ref of collectNodePropertyStepRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('GitHub workflow node-property action pinning', () => {
  it('enforces node-property flow steps across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableNodePropertyStepRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects mutable refs after anchors or tags regardless of key order', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `steps:\n  - &checkout { name: Checkout, uses: actions/checkout@${sha} }`;
    expect(collectNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableNodePropertyStepRefs(pinned, 'anchored-step.yml');

    const mutable = 'steps:\n  - &checkout { name: Checkout, uses: actions/checkout@v4 }';
    expect(() => expectImmutableNodePropertyStepRefs(mutable, 'anchored-step.yml')).toThrow();

    const tagged = 'steps:\n  - !custom { env: { NOTE: ok }, uses: actions/checkout@main }';
    expect(() => expectImmutableNodePropertyStepRefs(tagged, 'tagged-step.yml')).toThrow();
  });

  it('decodes escaped uses keys in anchored flow steps', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `steps:\n  - &checkout { "\\u0075ses": actions/checkout@${sha} }`;
    expect(collectNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableNodePropertyStepRefs(pinned, 'escaped-key.yml');

    const mutable = 'steps:\n  - &checkout { "\\u0075ses": actions/checkout@v4 }';
    expect(() => expectImmutableNodePropertyStepRefs(mutable, 'escaped-key.yml')).toThrow();
  });

  it('resolves aliased uses keys in node-property steps', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = [
      'name: &uses-key uses',
      'steps:',
      `  - &checkout { *uses-key: actions/checkout@${sha} }`,
    ].join('\n');
    expect(collectNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableNodePropertyStepRefs(pinned, 'aliased-key.yml');

    const mutable = [
      'name: &uses-key uses',
      'steps:',
      '  - &checkout { *uses-key: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectImmutableNodePropertyStepRefs(mutable, 'aliased-key.yml')).toThrow();
  });

  it('ignores node-property mappings outside an actual steps collection', () => {
    const safe = 'strategy:\n  matrix:\n    include:\n      - &case { uses: actions/checkout@v4, os: ubuntu-latest }';
    expect(collectNodePropertyStepRefs(safe)).toEqual([]);
    expectImmutableNodePropertyStepRefs(safe, 'matrix-data.yml');
  });

  it('ignores node-property examples inside block scalars', () => {
    const safe = [
      'env:',
      '  DOC: |',
      '    steps:',
      '      - &example { uses: actions/checkout@v4 }',
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expect(collectNodePropertyStepRefs(safe)).toEqual(['actions/checkout@0123456789abcdef0123456789abcdef01234567']);
    expectImmutableNodePropertyStepRefs(safe, 'block-scalar-doc.yml');
  });
});
