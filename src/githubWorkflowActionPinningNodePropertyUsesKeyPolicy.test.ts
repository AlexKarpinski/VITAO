import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^\s@]+@(?:[0-9a-fA-F]{40})$/;

const stripQuotedScalars = (value: string) => {
  let result = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (quote === '"' && char === '\\') {
        result += '  ';
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      result += ' ';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += ' ';
      continue;
    }
    result += char;
  }
  return result;
};

const collectNodePropertyUsesRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const line of workflow.split('\n')) {
    if (!/\bsteps\s*:/.test(stripQuotedScalars(line))) continue;
    const pattern = /(?:^|[,{[])[ \t]*(?:[&!][^\s{}:,]+[ \t]+)+uses[ \t]*:[ \t]*([^\s,}\]]+)/g;
    for (const match of line.matchAll(pattern)) refs.push(match[1].replace(/^['"]|['"]$/g, ''));
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

  it('accepts immutable action refs with anchored or tagged uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const anchored = `jobs: { build: { steps: [{ &uses-key uses: actions/checkout@${sha} }] } }`;
    const tagged = `jobs: { build: { steps: [{ !!str uses: actions/checkout@${sha} }] } }`;
    expect(() => assertImmutable(anchored, 'anchored.yml')).not.toThrow();
    expect(() => assertImmutable(tagged, 'tagged.yml')).not.toThrow();
  });

  it('ignores uses-like text inside quoted run scalars', () => {
    const safe = 'jobs: { build: { steps: [{ run: "echo &uses-key uses: actions/checkout@v4" }] } }';
    expect(collectNodePropertyUsesRefs(safe)).toEqual([]);
  });
});
