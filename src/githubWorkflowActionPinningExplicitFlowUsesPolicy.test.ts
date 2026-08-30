import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
type Quote = '"' | "'" | null;

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

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

const quoteStateAt = (line: string, end: number, initial: Quote = null) => {
  let quote = initial;
  for (let i = 0; i < end; i += 1) {
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
  return quote;
};

const isOutsideQuotedScalar = (line: string, index: number, initial: Quote = null) =>
  quoteStateAt(line, index, initial) === null;

const stripYamlComment = (line: string) => {
  let quote: Quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i).trimEnd();
      }
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
  return line;
};

const flowDelta = (line: string, initial: Quote = null) => {
  let quote = initial;
  let delta = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '[') {
        delta += 1;
      } else if (char === ']') {
        delta -= 1;
      }
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
  return { delta, quote };
};

const blockScalarHeader = (line: string) => /:\s*(?:(?:&[^\s]+|![^\s]*)\s+)*[|>](?:[+-]?[1-9]?|[1-9][+-]?)?\s*$/.test(stripYamlComment(line));

const collectExplicitFlowUses = (workflow: string) => {
  const refs: string[] = [];
  const pattern = /\?\s*(?:"uses"|'uses'|uses)\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/g;
  let stepsDepth = 0;
  let flowQuote: Quote = null;
  let blockScalarIndent: number | null = null;

  for (const rawLine of workflow.split('\n')) {
    const indent = indentOf(rawLine);
    const trimmed = rawLine.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;

    if (stepsDepth === 0 && blockScalarHeader(line)) {
      blockScalarIndent = indent;
      continue;
    }

    let segment = line;
    let initialQuote: Quote = stepsDepth > 0 ? flowQuote : null;

    if (stepsDepth === 0) {
      const stepsIndex = line.indexOf('steps:');
      if (stepsIndex < 0 || !isOutsideQuotedScalar(line, stepsIndex)) continue;
      const opener = line.indexOf('[', stepsIndex);
      if (opener < 0 || !isOutsideQuotedScalar(line, opener)) continue;
      segment = line.slice(opener);
      initialQuote = null;
    }

    for (const match of segment.matchAll(pattern)) {
      const matchIndex = match.index ?? 0;
      if (!isOutsideQuotedScalar(segment, matchIndex, initialQuote)) continue;
      refs.push(unquote(match[1]));
    }

    const structure = flowDelta(segment, initialQuote);
    stepsDepth = Math.max(0, stepsDepth + structure.delta);
    flowQuote = stepsDepth > 0 ? structure.quote : null;
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

  it('rejects explicit uses keys after a multiline flow sequence opener', () => {
    expect(() =>
      assertExplicitFlowUsesPinned(`
name: multiline-explicit-flow-uses
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [
      { ? uses : actions/checkout@v4 }
    ]
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

  it('ignores explicit flow uses examples inside block scalars', () => {
    expect(() =>
      assertExplicitFlowUsesPinned(`
name: explicit-flow-block-documentation
env:
  DOC: |
    steps: [
      { ? uses : actions/checkout@v4 }
    ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo safe
`),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertExplicitFlowUsesPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
