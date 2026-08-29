import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^\s@]+@[0-9a-f]{40}$/i;

const stripComment = (line: string) => {
  let single = false;
  let double = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !double) {
      if (single && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      single = !single;
      continue;
    }
    if (char === '"' && !single) {
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) slashes += 1;
      if (slashes % 2 === 0) double = !double;
      continue;
    }
    if (char === '#' && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
};

const splitTopLevelEntries = (mapping: string) => {
  const body = mapping.trim().replace(/^\{/, '').replace(/\}$/, '');
  const entries: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (quote === "'" && char === "'" && body[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === '"') {
          let slashes = 0;
          for (let cursor = index - 1; cursor >= 0 && body[cursor] === '\\'; cursor -= 1) slashes += 1;
          if (slashes % 2 === 1) continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const directUsesRef = (mapping: string) => {
  for (const entry of splitTopLevelEntries(mapping)) {
    const match = entry.match(/^\s*["']?uses["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    return match[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectFlowJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let directJobIndent: number | null = null;

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (/^\s*(?:["']?jobs["']?)\s*:\s*$/.test(line)) {
      jobsIndent = indent;
      directJobIndent = null;
      continue;
    }

    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      directJobIndent = null;
      continue;
    }

    const mapping = line.match(/^\s*(?:(?:&[^\s]+|![^\s]+)\s+)*(?:["']?[A-Za-z0-9_.-]+["']?)\s*:\s*(.*)$/);
    if (!mapping) continue;
    if (directJobIndent === null) directJobIndent = indent;
    if (indent !== directJobIndent) continue;

    const value = mapping[1].trim();
    if (!value || !/^\{/.test(value)) continue;
    const ref = directUsesRef(value);
    if (ref) refs.push(ref);
  }

  return refs;
};

const expectImmutableFlowJobs = (workflow: string, source: string) => {
  for (const ref of collectFlowJobRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: reusable workflow ${ref} must use a 40-character SHA`).toMatch(immutableRef);
  }
};

describe('flow job-key node-property action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableFlowJobs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable reusable workflow when the direct job key has an anchor', () => {
    const unsafe = [
      'jobs:',
      '  &call-key call: { uses: owner/repo/.github/workflows/build.yml@main }',
    ].join('\n');
    expect(() => expectImmutableFlowJobs(unsafe, 'anchored-job-key.yml')).toThrow();
  });

  it('accepts an anchored direct job key with an immutable reusable-workflow ref', () => {
    const safe = [
      'jobs:',
      '  &call-key call: { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectImmutableFlowJobs(safe, 'anchored-job-key-safe.yml');
  });

  it('ignores nested flow mappings inside a normal job', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    env: { uses: actions/checkout@v4 }',
      '    steps:',
      '      - run: echo ok',
    ].join('\n');
    expectImmutableFlowJobs(safe, 'nested-flow-safe.yml');
  });

  it('ignores nested uses fields inside an anchored flow-style job', () => {
    const safe = [
      'jobs:',
      '  &build-key build: { runs-on: ubuntu-latest, env: { uses: harmless-value@v4 }, steps: [{ run: echo ok }] }',
    ].join('\n');
    expectImmutableFlowJobs(safe, 'anchored-flow-job-nested-safe.yml');
  });

  it('still rejects a direct mutable uses after nested flow mappings', () => {
    const unsafe = [
      'jobs:',
      '  &call-key call: { with: { note: safe }, uses: owner/repo/.github/workflows/build.yml@main }',
    ].join('\n');
    expect(() => expectImmutableFlowJobs(unsafe, 'anchored-flow-job-direct-uses.yml')).toThrow();
  });
});
