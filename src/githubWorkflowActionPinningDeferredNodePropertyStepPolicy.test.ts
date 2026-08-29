import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const isImmutable = (ref: string) => {
  if (ref.startsWith('./') || ref.startsWith('docker://')) return true;
  const at = ref.lastIndexOf('@');
  return at > 0 && /^[0-9a-f]{40}$/i.test(ref.slice(at + 1));
};

const stripComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const nodeProperty = '(?:&[A-Za-z0-9_-]+|!(?:[^\\s{]+)?)';
const blockScalarValue = new RegExp(`:\\s*(?:${nodeProperty}\\s*)*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\\s*$`);

const collectDeferredNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let pendingIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) continue;

    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (blockScalarValue.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }

    if (stepsIndent === null) {
      if (/^steps\s*:\s*$/.test(trimmed)) stepsIndent = indent;
      continue;
    }
    if (indent <= stepsIndent) {
      stepsIndent = null;
      pendingIndent = null;
      continue;
    }

    if (pendingIndent !== null) {
      if (indent <= pendingIndent) pendingIndent = null;
      else {
        const mapping = trimmed.match(/^\{\s*(?:["']?uses["']?)\s*:\s*([^,}\s]+)\s*(?:,|})/);
        if (mapping) refs.push(mapping[1]);
        pendingIndent = null;
        continue;
      }
    }

    const inlinePropertyMapping = trimmed.match(new RegExp(`^-\\s+(?:${nodeProperty}\\s*)+\\{\\s*(?:["']?uses["']?)\\s*:\\s*([^,}\\s]+)\\s*(?:,|})`));
    if (inlinePropertyMapping) {
      refs.push(inlinePropertyMapping[1]);
      continue;
    }

    if (new RegExp(`^-\\s+(?:${nodeProperty}\\s*)+$`).test(trimmed)) {
      pendingIndent = indent;
      continue;
    }
  }

  return refs;
};

const expectImmutableDeferredNodePropertySteps = (workflow: string) => {
  for (const ref of collectDeferredNodePropertyStepRefs(workflow)) {
    expect(isImmutable(ref), `mutable action ref behind deferred node property: ${ref}`).toBe(true);
  }
};

describe('GitHub workflow deferred node-property step pinning policy', () => {
  it('rejects mutable action refs after a property-bearing step marker', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout',
      '        { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectImmutableDeferredNodePropertySteps(unsafe)).toThrow();
  });

  it('rejects mutable action refs behind a bare non-specific tag', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - ! { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectImmutableDeferredNodePropertySteps(unsafe)).toThrow();
  });

  it('accepts immutable action refs after a property-bearing step marker', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout',
      '        { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expect(() => expectImmutableDeferredNodePropertySteps(safe)).not.toThrow();
  });

  it('does not classify property-bearing entries outside steps', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include:',
      '          - &case',
      '            { uses: actions/checkout@v4 }',
      '    steps:',
      '      - run: echo ok',
    ].join('\n');
    expect(() => expectImmutableDeferredNodePropertySteps(safe)).not.toThrow();
  });

  it('ignores deferred node-property examples inside run block scalars', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: |',
      '          - &example',
      '            { uses: actions/checkout@v4 }',
      '      - run: echo safe',
    ].join('\n');
    expect(() => expectImmutableDeferredNodePropertySteps(safe)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectImmutableDeferredNodePropertySteps(readFileSync(join('.github/workflows', name), 'utf8'));
    }
  });
});
