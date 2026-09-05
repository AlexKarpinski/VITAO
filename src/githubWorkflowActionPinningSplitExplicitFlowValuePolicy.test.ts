import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripComment = (line: string) => {
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
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) slashes += 1;
      if (slashes % 2 === 1) continue;
    }
    quote = null;
  }
  return line;
};

const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[},\]]\s*$/, '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const collectSplitExplicitUses = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let flowDepth = 0;
  let pendingExplicitUses = false;
  let pendingIndent = -1;
  let blockScalarIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = indentOf(rawLine);
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (/:[ \t]*(?:(?:&[^\s]+|![^\s]*)[ \t]+)*[|>](?:[+-]?[1-9]?|[1-9][+-]?)?[ \t]*$/.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    if (stepsIndent !== null && flowDepth === 0 && indent <= stepsIndent) {
      stepsIndent = null;
      pendingExplicitUses = false;
    }

    const steps = line.match(/\bsteps\s*:\s*(.*)$/);
    if (steps && !/^\s*["']/.test(line.slice(0, steps.index ?? 0))) {
      stepsIndent = indent;
      const tail = steps[1];
      flowDepth += (tail.match(/\[/g) ?? []).length - (tail.match(/\]/g) ?? []).length;
    }

    const inSteps = stepsIndent !== null && (indent > stepsIndent || flowDepth > 0 || steps !== null);
    if (!inSteps) continue;

    if (pendingExplicitUses) {
      const value = trimmed.match(/^:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/);
      if (value) {
        refs.push(unquote(value[1]));
        pendingExplicitUses = false;
      } else if (indent <= pendingIndent && !/^[:}\],]/.test(trimmed)) {
        pendingExplicitUses = false;
      }
    }

    if (/\?\s*(?:(?:&[^\s]+|![^\s]*)\s+)*(?:"uses"|'uses'|uses)\s*$/.test(trimmed)) {
      pendingExplicitUses = true;
      pendingIndent = indent;
    }

    flowDepth += (line.match(/[\[{]/g) ?? []).length - (line.match(/[\]}]/g) ?? []).length;
    flowDepth = Math.max(0, flowDepth);
  }
  return refs;
};

const assertSplitExplicitUsesPinned = (workflow: string) => {
  for (const ref of collectSplitExplicitUses(workflow)) {
    expect(ref, `Expected immutable action pin, got ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub workflow split explicit flow uses values', () => {
  it('rejects a mutable action when the explicit uses value starts on the next line', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: [ { ? uses',
      '      : actions/checkout@v4 } ]',
    ].join('\n');
    expect(() => assertSplitExplicitUsesPinned(unsafe)).toThrow(/Expected immutable action pin/);
  });

  it('accepts an immutable action when the split explicit value is pinned', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: [ { ? uses',
      '      : actions/checkout@0123456789abcdef0123456789abcdef01234567 } ]',
    ].join('\n');
    expect(() => assertSplitExplicitUsesPinned(safe)).not.toThrow();
  });

  it('ignores split explicit uses-like text inside block scalars', () => {
    const safe = [
      'env:',
      '  DOC: |',
      '    steps: [ { ? uses',
      '      : actions/checkout@v4 } ]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(() => assertSplitExplicitUsesPinned(safe)).not.toThrow();
  });

  it('enforces split explicit flow values across checked-in workflows', () => {
    for (const file of workflowFiles) {
      assertSplitExplicitUsesPinned(readFileSync(join(workflowsDir, file), 'utf8'));
    }
  });
});
