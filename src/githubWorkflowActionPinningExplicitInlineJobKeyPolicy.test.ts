import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();
const immutable = /^[^\s@]+@(?:[0-9a-fA-F]{40})$/;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (line: string) => {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "'" && !double) {
      if (single && line[i + 1] === "'") {
        i += 1;
        continue;
      }
      single = !single;
      continue;
    }
    if (char === '"' && !single) {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j -= 1) backslashes += 1;
      if (backslashes % 2 === 0) double = !double;
      continue;
    }
    if (char === '#' && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

const stripKeyNodeProperties = (value: string) =>
  value.trim().replace(/^(?:(?:&[^\s]+|![^\s]+)\s+)*/, '');

const refsFromExplicitInlineJobs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let scalarIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = indentOf(rawLine);
    const trimmed = rawLine.trim();
    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }

    const structuralLine = stripYamlComment(rawLine);
    const scalar = structuralLine.match(/^\s*(?:-\s*)?(?:[^:#]+):\s*(.+?)\s*$/);
    if (scalar && scalarHeader.test(stripKeyNodeProperties(scalar[1]))) {
      scalarIndent = indent;
      continue;
    }

    const jobs = structuralLine.match(/^\s*jobs\s*:\s*\{(.*)\}\s*$/);
    if (!jobs) continue;
    const body = jobs[1];
    const explicitJob = /(?:^|,)\s*\?\s*((?:(?:&[^\s]+|![^\s]+)\s+)*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{([^{}]*)\}/g;
    for (const match of body.matchAll(explicitJob)) {
      const normalizedKey = stripKeyNodeProperties(match[1]);
      if (!normalizedKey) continue;
      const uses = match[2].match(/(?:^|,)\s*uses\s*:\s*([^,}\s]+)/);
      if (uses) refs.push(uses[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const assertPinned = (workflow: string) => {
  for (const ref of refsFromExplicitInlineJobs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `mutable reusable workflow ref: ${ref}`).toMatch(immutable);
  }
};

describe('explicit inline job-key action pinning policy', () => {
  it('rejects mutable reusable workflows behind explicit inline job ids', () => {
    expect(() => assertPinned('jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@main } }')).toThrow();
  });

  it('rejects mutable reusable workflows behind node-property explicit job ids', () => {
    expect(() => assertPinned('jobs: { ? &call-key call : { uses: owner/repo/.github/workflows/build.yml@main } }')).toThrow();
  });

  it('ignores explicit inline job examples inside block scalars', () => {
    const documented = [
      'env:',
      '  DOC: |',
      '    jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@main } }',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(() => assertPinned(documented)).not.toThrow();
  });

  it('accepts immutable reusable workflow refs', () => {
    expect(() => assertPinned('jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 } }')).not.toThrow();
  });

  it('enforces every checked-in workflow', () => {
    for (const file of workflowFiles) assertPinned(readFileSync(join(workflowsDir, file), 'utf8'));
  });
});
