import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const directUses = (mappingBody: string) => {
  for (const entry of splitTopLevel(mappingBody)) {
    const match = entry.match(/^\s*["']?uses["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectAliasedJobRefs = (workflow: string) => {
  const lines = workflow.split('\n');
  const anchoredRefs = new Map<string, string>();

  for (const line of lines) {
    const anchor = line.match(/&([A-Za-z0-9_-]+)\s*\{([\s\S]*)\}/);
    if (!anchor) continue;
    const ref = directUses(anchor[2]);
    if (ref) anchoredRefs.set(anchor[1], ref);
  }

  const refs: string[] = [];
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = indentOf(line);
    const jobs = line.match(/^\s*["']?jobs["']?\s*:\s*$/);
    if (jobs) {
      jobsIndent = indent;
      jobIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      continue;
    }

    const mappingEntry = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (jobIndent === null && mappingEntry) jobIndent = indent;

    const aliasJob = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\*([A-Za-z0-9_-]+)\s*(?:#.*)?$/);
    if (!aliasJob || indent !== jobIndent) continue;
    const ref = anchoredRefs.get(aliasJob[1]);
    if (ref) refs.push(ref);
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectAliasedJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('aliased reusable-workflow job pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable reusable workflow hidden behind a job alias', () => {
    const unsafe = [
      'jobs:',
      '  seed:',
      '    strategy:',
      '      matrix:',
      '        include: [ &call-job { uses: owner/repo/.github/workflows/build.yml@main } ]',
      '    steps:',
      '      - run: echo seed',
      '  call: *call-job',
    ].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'aliased-job.yml')).toThrow();
  });

  it('accepts an immutable reusable workflow hidden behind a job alias', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'jobs:',
      '  seed:',
      '    strategy:',
      '      matrix:',
      `        include: [ &call-job { uses: owner/repo/.github/workflows/build.yml@${sha} } ]`,
      '    steps:',
      '      - run: echo seed',
      '  call: *call-job',
    ].join('\n');
    expectImmutableRefs(safe, 'aliased-job-pinned.yml');
  });

  it('ignores aliases used below direct job-entry indentation', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    env:',
      '      CONFIG: *call-job',
      '    steps:',
      '      - run: echo safe',
      'metadata: &call-job { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(collectAliasedJobRefs(safe)).toEqual([]);
  });
});
