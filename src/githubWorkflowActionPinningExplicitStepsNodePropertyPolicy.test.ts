import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const stripNodeProperties = (value: string) =>
  value.replace(/^(?:(?:&[A-Za-z0-9_.-]+|![^\s]+|!![^\s]+)\s+)+/, '').trim();

const collectDecoratedExplicitStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let ignoredScalarIndent: number | null = null;

  for (const raw of lines) {
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (ignoredScalarIndent !== null) {
      if (!trimmed || indent > ignoredScalarIndent) continue;
      ignoredScalarIndent = null;
    }

    const scalar = raw.match(/^\s*[^:#]+:\s*(.+)$/);
    if (scalar && scalarHeader.test(stripNodeProperties(scalar[1]))) {
      ignoredScalarIndent = indent;
      continue;
    }

    const explicit = raw.match(/^\s*\?\s+(.+)$/);
    if (!explicit) continue;
    const key = stripNodeProperties(explicit[1]).replace(/^['"]|['"]$/g, '');
    if (key !== 'steps') continue;

    const lineIndex = lines.indexOf(raw);
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      const valueLine = lines[index];
      const valueIndent = valueLine.match(/^\s*/)?.[0].length ?? 0;
      if (valueLine.trim() && valueIndent < indent) break;
      const match = valueLine.match(/(?:^|[{,[]\s*)uses\s*:\s*['"]?([^'"\s,}\]]+)/);
      if (match) refs.push(match[1]);
      if (/^\s*\]/.test(valueLine) || /^\s*[^\s].*:/.test(valueLine) && valueIndent <= indent) break;
    }
  }

  return refs;
};

const assertPinned = (workflow: string) => {
  for (const ref of collectDecoratedExplicitStepRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `Expected immutable action pin, got ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub explicit steps node-property pinning policy', () => {
  it('rejects mutable actions behind tagged explicit steps keys', () => {
    const unsafe = `
name: explicit-tagged-steps
jobs:
  build:
    runs-on: ubuntu-latest
    ? !!str steps
    : [{ uses: actions/checkout@v4 }]
`;
    expect(() => assertPinned(unsafe)).toThrow(/Expected immutable action pin/);
  });

  it('accepts immutable actions behind tagged explicit steps keys', () => {
    const safe = `
name: explicit-tagged-steps
jobs:
  build:
    runs-on: ubuntu-latest
    ? !!str steps
    : [{ uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }]
`;
    expect(() => assertPinned(safe)).not.toThrow();
  });

  it('scans every checked-in workflow', () => {
    for (const file of workflowFiles) {
      assertPinned(readFileSync(join(workflowsDir, file), 'utf8'));
    }
  });
});
