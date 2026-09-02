import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^\s@]+@(?:[0-9a-fA-F]{40})$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripQuotedScalarsByLine = (workflow: string) => {
  let quote: '"' | "'" | null = null;
  let quotedValue = '';
  return workflow.split('\n').map((value) => {
    let result = '';
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (quote) {
        if (quote === '"' && char === '\\') {
          quotedValue += char;
          result += ' ';
          if (i + 1 < value.length) {
            quotedValue += value[i + 1];
            result += ' ';
            i += 1;
          }
          continue;
        }
        if (quote === "'" && char === "'" && value[i + 1] === "'") {
          quotedValue += "''";
          result += '  ';
          i += 1;
          continue;
        }
        if (char === quote) {
          const closingQuote = quote;
          quote = null;
          let cursor = i + 1;
          while (cursor < value.length && /[ \t]/.test(value[cursor])) cursor += 1;
          const isMappingKey = value[cursor] === ':';
          let decoded = quotedValue;
          if (closingQuote === '"') {
            try {
              decoded = JSON.parse(`"${quotedValue}"`);
            } catch {
              decoded = quotedValue;
            }
          } else {
            decoded = quotedValue.replace(/''/g, "'");
          }
          result += isMappingKey && decoded === 'uses' ? 'uses' : ' '.repeat(quotedValue.length + 2);
          quotedValue = '';
          continue;
        }
        quotedValue += char;
        result += ' ';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        quotedValue = '';
        continue;
      }
      result += char;
    }
    return result;
  });
};

const stripPlainScalarContinuations = (lines: string[]) => {
  let scalarIndent: number | null = null;
  return lines.map((line) => {
    const trimmed = line.trim();
    const indent = indentOf(line);
    if (scalarIndent !== null) {
      if (!trimmed) return line;
      if (indent > scalarIndent) return ' '.repeat(line.length);
      scalarIndent = null;
    }

    const mapping = line.match(/^\s*(?!-)([^:#][^:]*):[ \t]+(.+)$/);
    if (mapping) {
      const value = mapping[2].trim();
      if (value && !/^[{[\]|>&!*]/.test(value) && !value.startsWith('#')) scalarIndent = indent;
    }
    return line;
  });
};

const cleanDeferredRef = (line: string) => line.trim().replace(/[}\],]+\s*$/, '').trim().replace(/^['"]|['"]$/g, '');

const collectNodePropertyUsesRefs = (workflow: string) => {
  const refs: string[] = [];
  const strippedLines = stripPlainScalarContinuations(stripQuotedScalarsByLine(workflow));
  let pendingDecoratedUses = false;
  for (let index = 0; index < strippedLines.length; index += 1) {
    const line = strippedLines[index];
    const trimmed = line.trim();

    if (pendingDecoratedUses) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      const ref = cleanDeferredRef(line);
      if (ref) refs.push(ref);
      pendingDecoratedUses = false;
      continue;
    }

    if (!/\bsteps\s*:/.test(line)) continue;
    const pattern = /(?:^|[,{[])[ \t]*(?:[&!][^\s{}:,]+[ \t]+)+uses[ \t]*:[ \t]*([^\s,}\]]+)/g;
    for (const match of line.matchAll(pattern)) refs.push(match[1].replace(/^['"]|['"]$/g, ''));

    const deferredPattern = /(?:^|[,{[])[ \t]*(?:[&!][^\s{}:,]+[ \t]+)+uses[ \t]*:[ \t]*$/;
    if (deferredPattern.test(line)) pendingDecoratedUses = true;
  }
  return refs;
};

const assertImmutable = (workflow: string, source: string) => {
  for (const ref of collectNodePropertyUsesRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(immutableRef.test(ref), `${source}: node-property uses ref must be pinned: ${ref}`).toBe(true);
  }
};

describe('GitHub workflow node-property uses-key pinning policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertImmutable(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects mutable action refs when a node property precedes the uses key', () => {
    const unsafe = 'jobs: { build: { steps: [{ &uses-key uses: actions/checkout@v4 }] } }';
    expect(() => assertImmutable(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects mutable action refs when a node property decorates a quoted uses key', () => {
    const unsafe = 'jobs: { build: { steps: [{ &uses-key "uses": actions/checkout@v4 }] } }';
    expect(() => assertImmutable(unsafe, 'quoted-key.yml')).toThrow();
  });

  it('follows decorated uses keys to deferred plain-scalar values', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const mutable = ['jobs: { build: { steps: [{ &uses-key uses:', '  actions/checkout@v4 }] } }'].join('\n');
    const pinned = ['jobs: { build: { steps: [{ &uses-key uses:', `  actions/checkout@${sha} }] } }`].join('\n');
    expect(collectNodePropertyUsesRefs(mutable)).toEqual(['actions/checkout@v4']);
    expect(() => assertImmutable(mutable, 'deferred-mutable.yml')).toThrow();
    expect(() => assertImmutable(pinned, 'deferred-pinned.yml')).not.toThrow();
  });

  it('accepts immutable action refs with anchored or tagged uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const anchored = `jobs: { build: { steps: [{ &uses-key uses: actions/checkout@${sha} }] } }`;
    const tagged = `jobs: { build: { steps: [{ !!str uses: actions/checkout@${sha} }] } }`;
    const quoted = `jobs: { build: { steps: [{ &uses-key 'uses': actions/checkout@${sha} }] } }`;
    expect(() => assertImmutable(anchored, 'anchored.yml')).not.toThrow();
    expect(() => assertImmutable(tagged, 'tagged.yml')).not.toThrow();
    expect(() => assertImmutable(quoted, 'quoted.yml')).not.toThrow();
  });

  it('ignores uses-like text inside quoted run scalars', () => {
    const safe = 'jobs: { build: { steps: [{ run: "echo &uses-key uses: actions/checkout@v4" }] } }';
    expect(collectNodePropertyUsesRefs(safe)).toEqual([]);
  });

  it('ignores decorated uses documentation inside multiline quoted scalars', () => {
    const safe = [
      'env:',
      '  DOC: "first line',
      '    jobs: { build: { steps: [{ &uses-key uses: actions/checkout@v4 }] } }',
      '    final line"',
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectNodePropertyUsesRefs(safe)).toEqual([]);
  });

  it('ignores decorated uses documentation inside multiline plain scalars', () => {
    const safe = [
      'env:',
      '  DOC: This documentation spans',
      '    jobs: { build: { steps:[{ &uses-key uses:actions/checkout@v4 }] } }',
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectNodePropertyUsesRefs(safe)).toEqual([]);
  });
});
