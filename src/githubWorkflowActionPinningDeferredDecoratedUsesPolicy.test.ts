import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[0-9a-f]{40}$/i;

const stripComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
};

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try {
      return JSON.parse(key) as string;
    } catch {
      return key;
    }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const expectDeferredDecoratedUsesPinned = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripComment(raw);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    const section = trimmed.match(/^((?:"(?:\\.|[^"])*")|(?:'(?:''|[^'])*')|(?:[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    if (section && decodeKey(section[1]) === 'steps') {
      stepsIndent = indent;
      continue;
    }

    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (stepsIndent === null) continue;

    if (/:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }

    const deferred = trimmed.match(/^-\s+(?:(?:&[^\s]+|![^\s]*)\s+)+uses\s*:\s*$/);
    if (!deferred) continue;

    for (let child = index + 1; child < lines.length; child += 1) {
      const childRaw = lines[child];
      const childValue = stripComment(childRaw).trim();
      if (!childValue) continue;
      const childIndent = childRaw.match(/^\s*/)?.[0].length ?? 0;
      if (childIndent <= indent) break;

      const ref = childValue.replace(/[,}]\s*$/, '').trim().replace(/^['"]|['"]$/g, '');
      if (ref.startsWith('./') || ref.startsWith('docker://')) break;
      const at = ref.lastIndexOf('@');
      expect(at).toBeGreaterThan(0);
      expect(immutableSha.test(ref.slice(at + 1)), `${source}: mutable deferred decorated action ref ${ref}`).toBe(true);
      break;
    }
  }
};

describe('GitHub workflow deferred decorated uses policy', () => {
  it('rejects a mutable decorated uses value deferred to the next scalar line', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses:',
      '          actions/checkout@v4',
    ].join('\n');

    expect(() => expectDeferredDecoratedUsesPinned(unsafe, 'deferred.yml')).toThrow();
  });

  it('accepts a deferred decorated uses value pinned to a full SHA', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses:',
      '          actions/checkout@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');

    expectDeferredDecoratedUsesPinned(safe, 'deferred-pinned.yml');
  });

  it('ignores uses-like documentation inside run block scalars and scans checked-in workflows', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: |',
      '          - &uses-key uses:',
      '              actions/checkout@v4',
    ].join('\n');
    expectDeferredDecoratedUsesPinned(safe, 'documentation.yml');

    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectDeferredDecoratedUsesPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
