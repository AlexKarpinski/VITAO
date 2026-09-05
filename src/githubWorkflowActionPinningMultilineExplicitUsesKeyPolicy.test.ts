import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const joinDoubleQuotedContinuations = (workflow: string) => {
  let result = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < workflow.length; index += 1) {
    const char = workflow[index];
    if (quote === '"' && char === '\\' && workflow[index + 1] === '\n') {
      index += 1;
      while (workflow[index + 1] === ' ' || workflow[index + 1] === '\t') index += 1;
      continue;
    }
    result += char;
    if (!quote && (char === '"' || char === "'")) {
      quote = char;
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && workflow[index + 1] === "'") {
      result += workflow[index + 1];
      index += 1;
      continue;
    }
    if (quote === '"') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && workflow[cursor] === '\\'; cursor -= 1) backslashes += 1;
      if (backslashes % 2 === 1) continue;
    }
    quote = null;
  }
  return result;
};

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (!quote) {
      if (char === '"' || char === "'") quote = char;
      else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote === '"') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) backslashes += 1;
      if (backslashes % 2 === 1) continue;
    }
    quote = null;
  }
  return line;
};

const structuralSquareDelta = (line: string) => {
  let quote: '"' | "'" | null = null;
  let delta = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (!quote) {
      if (char === '"' || char === "'") quote = char;
      else if (char === '[') delta += 1;
      else if (char === ']') delta -= 1;
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote === '"') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) backslashes += 1;
      if (backslashes % 2 === 1) continue;
    }
    quote = null;
  }
  return delta;
};

const collectMultilineExplicitUsesRefs = (workflow: string) => {
  const refs: string[] = [];
  const normalized = joinDoubleQuotedContinuations(workflow);
  const lines = normalized.split('\n');
  const explicitUses = /\?\s*(?:(?:&[^\s]+|![^\s]*)\s+)*(?:"uses"|'uses'|uses)\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/g;
  let stepsIndent: number | null = null;
  let flowDepth = 0;
  let blockScalarIndent: number | null = null;

  for (const raw of lines) {
    const indent = indentOf(raw);
    const trimmed = raw.trim();
    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    const line = stripYamlComment(raw);
    if (!line.trim()) continue;

    const scalar = line.match(/:\s*(\S+)\s*$/);
    if (scalar && scalarHeader.test(scalar[1])) {
      blockScalarIndent = indent;
      continue;
    }

    if (flowDepth === 0 && stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (flowDepth === 0) {
      const steps = line.match(/^\s*["']?steps["']?\s*:\s*(.*)$/);
      if (steps) {
        stepsIndent = indent;
        const opener = steps[1].indexOf('[');
        if (opener >= 0) flowDepth = structuralSquareDelta(steps[1].slice(opener));
      }
    }

    const inSteps = flowDepth > 0 || (stepsIndent !== null && indent > stepsIndent);
    if (inSteps) {
      for (const match of line.matchAll(explicitUses)) refs.push(match[1].replace(/^['"]|['"]$/g, ''));
    }

    if (flowDepth > 0 && !/^\s*["']?steps["']?\s*:/.test(line)) {
      flowDepth = Math.max(0, flowDepth + structuralSquareDelta(line));
    }
  }
  return refs;
};

const assertMultilineExplicitUsesPinned = (workflow: string) => {
  for (const ref of collectMultilineExplicitUsesRefs(workflow)) {
    expect(ref, `Expected immutable action pin, got ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub workflow multiline explicit uses-key pinning policy', () => {
  it('rejects an escaped-line-continuation key that decodes to uses', () => {
    const unsafe = [
      'name: multiline-explicit-key',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: [',
      '      { ? "us\\',
      '          es" : actions/checkout@v4 }',
      '    ]',
    ].join('\n');
    expect(() => assertMultilineExplicitUsesPinned(unsafe)).toThrow(/Expected immutable action pin/);
  });

  it('accepts the same multiline key with an immutable action SHA', () => {
    const safe = [
      'name: multiline-explicit-key-pinned',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: [',
      '      { ? "us\\',
      '          es" : actions/checkout@0123456789abcdef0123456789abcdef01234567 }',
      '    ]',
    ].join('\n');
    expect(() => assertMultilineExplicitUsesPinned(safe)).not.toThrow();
  });

  it('ignores multiline explicit-key examples inside block scalars', () => {
    const safe = [
      'env:',
      '  DOC: |',
      '    steps: [',
      '      { ? "us\\',
      '          es" : actions/checkout@v4 }',
      '    ]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(() => assertMultilineExplicitUsesPinned(safe)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const file of workflowFiles) {
      assertMultilineExplicitUsesPinned(readFileSync(join(workflowsDir, file), 'utf8'));
    }
  });
});
