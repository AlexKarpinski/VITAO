import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /@[0-9a-f]{40}$/i;
const blockScalarHeader = /:\s*(?:[&!]\S*\s+)*(?:[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?)\s*(?:#.*)?$/;

const decodeYamlKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key); } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const stripInlineComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === '"' && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const stripQuotedScalars = (value: string) => {
  let result = '';
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"') {
      if (char === '\\') { backslashes += 1; result += ' '; continue; }
      if (char === '"' && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      result += ' ';
      continue;
    }
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") { result += '  '; index += 1; continue; }
      if (char === "'") quote = null;
      result += ' ';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; result += ' '; continue; }
    result += char;
  }
  return result;
};

const collectDecoratedStepsRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let scalarIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const uncommented = stripInlineComment(rawLine);
    const trimmed = uncommented.trim();

    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }
    if (!trimmed) continue;
    if (blockScalarHeader.test(uncommented)) { scalarIndent = indent; continue; }

    const decorated = uncommented.match(/^\s*(?:(?:&[A-Za-z0-9_-]+|!(?:<[^>]+>|[^\s]*)?)\s+)+((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(\[.*)$/);
    if (!decorated || decodeYamlKey(decorated[1]) !== 'steps') continue;

    const structural = stripQuotedScalars(decorated[2]);
    const usesPattern = /(?:^|[\[{,])\s*(?:uses|"uses"|'uses')\s*:\s*([^,}\]\s]+)/g;
    for (const match of structural.matchAll(usesPattern)) refs.push(match[1]);
  }

  return refs;
};

const expectImmutableDecoratedStepsRefs = (workflow: string) => {
  for (const ref of collectDecoratedStepsRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `mutable action reference ${ref} under decorated steps key`).toMatch(immutableRef);
  }
};

describe('GitHub workflow decorated steps-key pinning policy', () => {
  it('rejects an anchored escaped steps key with a mutable action', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    &step-key "\\u0073teps": [{ uses: actions/checkout@v4 }]',
    ].join('\n');
    expect(() => expectImmutableDecoratedStepsRefs(unsafe)).toThrow();
  });

  it('rejects a tagged steps key with a mutable action', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    !!str steps: [{ uses: actions/checkout@v4 }]',
    ].join('\n');
    expect(() => expectImmutableDecoratedStepsRefs(unsafe)).toThrow();
  });

  it('accepts immutable and local action references', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    &step-key steps: [{ uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }, { uses: ./local-action }]',
    ].join('\n');
    expect(() => expectImmutableDecoratedStepsRefs(safe)).not.toThrow();
  });

  it('ignores decorated steps examples inside block scalars', () => {
    const safe = [
      'env:',
      '  DOC: |',
      '    &step-key steps: [{ uses: actions/checkout@v4 }]',
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(() => expectImmutableDecoratedStepsRefs(safe)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectImmutableDecoratedStepsRefs(readFileSync(join('.github/workflows', name), 'utf8'));
    }
  });
});
