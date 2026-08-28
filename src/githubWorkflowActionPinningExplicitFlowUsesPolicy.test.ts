import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;

const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[},\]]\s*$/, '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const collectExplicitFlowUses = (workflow: string) => {
  const refs: string[] = [];
  const pattern = /\?\s*(?:"uses"|'uses'|uses)\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/g;

  for (const line of workflow.split('\n')) {
    const stepsIndex = line.indexOf('steps:');
    if (stepsIndex < 0 || line.indexOf('[', stepsIndex) < 0) continue;

    for (const match of line.slice(stepsIndex).matchAll(pattern)) {
      refs.push(unquote(match[1]));
    }
  }

  return refs;
};

const assertExplicitFlowUsesPinned = (workflow: string) => {
  for (const ref of collectExplicitFlowUses(workflow)) {
    expect(ref, `Expected immutable action pin, got ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub workflow explicit flow uses pinning policy', () => {
  it('rejects mutable explicit uses keys inside flow-style steps', () => {
    expect(() =>
      assertExplicitFlowUsesPinned(`
name: explicit-flow-uses
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [ { ? uses : actions/checkout@v4 } ]
`),
    ).toThrow(/Expected immutable action pin/);
  });

  it('accepts immutable explicit uses keys inside flow-style steps', () => {
    expect(() =>
      assertExplicitFlowUsesPinned(`
name: explicit-flow-uses
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [ { ? uses : actions/checkout@0123456789abcdef0123456789abcdef01234567 } ]
`),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertExplicitFlowUsesPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
