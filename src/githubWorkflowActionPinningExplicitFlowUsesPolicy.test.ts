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

const isOutsideQuotedScalar = (line: string, index: number) => {
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < index; i += 1) {
    const char = line[i];
    if (!quote) {
      if (char === '"' || char === "'") quote = char;
      continue;
    }

    if (char !== quote) continue;

    if (quote === "'" && line[i + 1] === "'") {
      i += 1;
      continue;
    }

    if (quote === '"') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j -= 1) backslashes += 1;
      if (backslashes % 2 === 1) continue;
    }

    quote = null;
  }

  return quote === null;
};

const collectExplicitFlowUses = (workflow: string) => {
  const refs: string[] = [];
  const pattern = /\?\s*(?:"uses"|'uses'|uses)\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/g;

  for (const line of workflow.split('\n')) {
    const stepsIndex = line.indexOf('steps:');
    if (stepsIndex < 0 || !isOutsideQuotedScalar(line, stepsIndex)) continue;
    if (line.indexOf('[', stepsIndex) < 0) continue;

    for (const match of line.slice(stepsIndex).matchAll(pattern)) {
      const matchIndex = stepsIndex + (match.index ?? 0);
      if (!isOutsideQuotedScalar(line, matchIndex)) continue;
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

  it('ignores explicit uses examples inside quoted run strings', () => {
    expect(() =>
      assertExplicitFlowUsesPinned(`
name: explicit-flow-documentation
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: 'echo "steps: [ { ? uses : actions/checkout@v4 } ]"'
`),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertExplicitFlowUsesPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
