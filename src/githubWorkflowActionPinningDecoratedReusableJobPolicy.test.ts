import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const keyPattern = '(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\'\'|[^\'])*\'|[A-Za-z_][A-Za-z0-9_-]*)';
const nodeProperty = '(?:(?:&[^\\s]+|!(?:[^\\s]+)?)\\s+)+';
const blockScalarHeader = /:\s*(?:(?:&[^\s]+|!(?:[^\s]+)?)\s+)*(?:[|>](?:[1-9][+-]?|[+-][1-9]?|[+-])?)\s*(?:#.*)?$/;

type Quote = '"' | "'" | null;

const quoteIsEscaped = (line: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const advanceQuoteState = (line: string, initial: Quote): Quote => {
  let quote = initial;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === '"' && !quoteIsEscaped(line, index)) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char !== "'") continue;
      if (line[index + 1] === "'") {
        index += 1;
        continue;
      }
      quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
  }
  return quote;
};

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const unquote = (raw: string) => {
  const value = raw.trim().replace(/\s+#.*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const collectDecoratedReusableRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let fieldIndent: number | null = null;
  let blockScalarIndent: number | null = null;
  let quoteState: Quote = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = indentOf(line);
    const startedInsideQuote = quoteState !== null;
    quoteState = advanceQuoteState(line, quoteState);
    if (startedInsideQuote) continue;

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    if (!trimmed || trimmed.startsWith('#')) continue;
    if (blockScalarHeader.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    if (jobsIndent === null) {
      const section = line.match(new RegExp(`^\\s*(${keyPattern})\\s*:\\s*$`));
      if (section && decodeKey(section[1]) === 'jobs') jobsIndent = indent;
      continue;
    }

    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      fieldIndent = null;
      continue;
    }

    const job = line.match(new RegExp(`^\\s*(${keyPattern})\\s*:\\s*$`));
    if (job && (jobIndent === null || indent === jobIndent)) {
      jobIndent = indent;
      fieldIndent = null;
      continue;
    }
    if (jobIndent === null || indent <= jobIndent) continue;
    if (fieldIndent === null) fieldIndent = indent;
    if (indent !== fieldIndent) continue;

    const decorated = line.match(new RegExp(`^\\s*${nodeProperty}(${keyPattern})\\s*:\\s*(.+?)\\s*$`));
    if (decorated && decodeKey(decorated[1]) === 'uses') refs.push(unquote(decorated[2]));
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectDecoratedReusableRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('decorated reusable-job action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects mutable reusable-workflow refs behind node properties', () => {
    const unsafe = ['jobs:', '  call:', '    ! uses: owner/repo/.github/workflows/build.yml@main'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'decorated-job.yml')).toThrow();
  });

  it('accepts immutable reusable-workflow refs behind node properties', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  call:', `    &uses-key uses: owner/repo/.github/workflows/build.yml@${sha}`].join('\n');
    expect(collectDecoratedReusableRefs(safe)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectImmutableRefs(safe, 'decorated-job-pinned.yml');
  });

  it('does not treat nested decorated data keys as reusable-job uses fields', () => {
    const safe = ['jobs:', '  build:', '    env:', '      ! uses: actions/checkout@v4', '    steps:', '      - run: echo safe'].join('\n');
    expect(collectDecoratedReusableRefs(safe)).toEqual([]);
  });

  it('ignores decorated reusable-job examples inside block scalars', () => {
    const safe = [
      'name: |',
      '  jobs:',
      '    call:',
      '      ! uses: owner/repo/.github/workflows/build.yml@main',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectDecoratedReusableRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'block-scalar-doc.yml');
  });

  it('ignores decorated reusable-job examples inside multiline quoted scalars', () => {
    const safe = [
      'name: "documentation begins',
      '  jobs:',
      '    call:',
      '      ! uses: owner/repo/.github/workflows/build.yml@main',
      '  documentation ends"',
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectDecoratedReusableRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'quoted-scalar-doc.yml');
  });
});
