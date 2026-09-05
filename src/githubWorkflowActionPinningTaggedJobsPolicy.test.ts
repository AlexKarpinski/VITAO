import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[0-9a-f]{40}$/i;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const stripLeadingNodeProperties = (value: string) => {
  let remaining = value.trimStart();
  while (remaining) {
    const property = remaining.match(/^(?:&[A-Za-z0-9_-]+|!(?:<[^>]+>|[^\s]*))\s+/);
    if (!property) break;
    remaining = remaining.slice(property[0].length);
  }
  return remaining;
};

const isBlockScalarHeader = (line: string) => {
  const mapping = line.match(/^\s*(?:-\s+)?[^:#][^:]*:\s*(.*?)\s*$/);
  if (!mapping) return false;
  const value = stripLeadingNodeProperties(mapping[1]);
  return /^[|>][0-9+-]*$/.test(value);
};

const reusableWorkflowRef = (value: string) => {
  const unquoted = value.trim().replace(/^['"]|['"]$/g, '');
  const match = unquoted.match(/^([^\s]+\/.github\/workflows\/[^\s@]+)@([^\s]+)$/);
  return match ? { path: match[1], ref: match[2] } : null;
};

const collectTaggedJobsReusableRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let fieldIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = indentOf(rawLine);
    if (blockScalarIndent !== null) {
      if (!rawLine.trim() || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    const structural = stripYamlComment(rawLine);
    const trimmed = structural.trim();
    if (!trimmed) continue;

    if (isBlockScalarHeader(structural)) {
      blockScalarIndent = indent;
      continue;
    }

    const decoded = stripLeadingNodeProperties(trimmed);
    if (/^jobs\s*:\s*$/.test(decoded)) {
      jobsIndent = indent;
      jobIndent = null;
      fieldIndent = null;
      continue;
    }

    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      fieldIndent = null;
      continue;
    }

    if (jobIndent === null) {
      if (/^[^\s][^:]*\s*:\s*$/.test(decoded)) jobIndent = indent;
      continue;
    }

    if (indent === jobIndent && /^[^\s][^:]*\s*:\s*$/.test(decoded)) {
      fieldIndent = null;
      continue;
    }
    if (indent <= jobIndent) continue;

    const keyValue = decoded.match(/^uses\s*:\s*(.+?)\s*$/);
    if (fieldIndent === null && /^[^\s][^:]*\s*:/.test(decoded)) fieldIndent = indent;
    if (!keyValue || indent !== fieldIndent) continue;

    const reusable = reusableWorkflowRef(keyValue[1]);
    if (reusable) refs.push(reusable.ref);
  }

  return refs;
};

const expectImmutableTaggedJobs = (workflow: string, source: string) => {
  for (const ref of collectTaggedJobsReusableRefs(workflow)) {
    expect(immutableSha.test(ref), `${source}: reusable workflow under a tagged jobs section must use a 40-character commit SHA`).toBe(true);
  }
};

describe('tagged jobs reusable-workflow pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableTaggedJobs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable reusable-workflow ref under a bare tagged jobs key', () => {
    const unsafe = [
      '! jobs:',
      '  call:',
      '    uses: owner/repo/.github/workflows/build.yml@main',
    ].join('\n');
    expect(() => expectImmutableTaggedJobs(unsafe, 'bare-tagged-jobs.yml')).toThrow();
  });

  it('accepts an immutable reusable-workflow ref under a bare tagged jobs key', () => {
    const safe = [
      '! jobs:',
      '  call:',
      '    uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');
    expectImmutableTaggedJobs(safe, 'bare-tagged-jobs-pinned.yml');
  });

  it('recognizes explicit tags and anchors before the jobs key', () => {
    const unsafe = [
      '!<tag:yaml.org,2002:map> &root jobs:',
      '  call:',
      '    uses: owner/repo/.github/workflows/build.yml@release',
    ].join('\n');
    expect(() => expectImmutableTaggedJobs(unsafe, 'decorated-jobs.yml')).toThrow();
  });

  it('ignores tagged jobs examples inside block scalars', () => {
    const safe = [
      'env:',
      '  DOC: |',
      '    ! jobs:',
      '      call:',
      '        uses: owner/repo/.github/workflows/build.yml@main',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectImmutableTaggedJobs(safe, 'tagged-jobs-docs.yml');
  });
});