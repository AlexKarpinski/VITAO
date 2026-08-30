import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^\s@]+@([0-9a-f]{40})$/i;
type Quote = "'" | '"' | null;

const stripComment = (line: string) => {
  let quote: Quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
};

const splitTopLevel = (value: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: Quote = null;
  let braces = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === ',' && braces === 0 && brackets === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries;
};

const decodeKey = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const directUsesRef = (mapping: string) => {
  const trimmed = mapping.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  for (const entry of splitTopLevel(body)) {
    const separator = entry.indexOf(':');
    if (separator < 0) continue;
    const key = decodeKey(entry.slice(0, separator));
    if (key !== 'uses') continue;
    return entry.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectBareTaggedStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let scalarIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = rawLine.trim();
    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }

    const structural = stripComment(rawLine);
    if (/^\s*[^:#]+:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(structural)) {
      scalarIndent = indent;
      continue;
    }

    const match = structural.match(/^\s*(?:steps|"steps"|'steps')\s*:\s*!\s*(\[.*\])\s*$/);
    if (!match) continue;
    const sequence = match[1].trim();
    const body = sequence.slice(1, -1);
    for (const item of splitTopLevel(body)) {
      const ref = directUsesRef(item);
      if (ref) refs.push(ref);
    }
  }

  return refs;
};

const expectBareTaggedStepsPinned = (workflow: string, source: string) => {
  for (const ref of collectBareTaggedStepRefs(workflow)) {
    expect(ref, `${source}: bare-tagged action step must use an immutable 40-character SHA`).toMatch(immutableRef);
  }
};

describe('bare-tagged steps immutable pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectBareTaggedStepsPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable action in a bare-tagged steps sequence', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: ! [{ uses: actions/checkout@v4 }]',
    ].join('\n');
    expect(() => expectBareTaggedStepsPinned(workflow, 'unsafe.yml')).toThrow();
  });

  it('accepts an immutable action in a bare-tagged steps sequence', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: ! [{ uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }]',
    ].join('\n');
    expectBareTaggedStepsPinned(workflow, 'safe.yml');
  });

  it('ignores uses-like text inside a run scalar', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: ! [{ run: "echo uses: actions/checkout@v4" }]',
    ].join('\n');
    expectBareTaggedStepsPinned(workflow, 'run.yml');
  });
});
