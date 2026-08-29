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
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (single) {
      if (ch === "'" && line[i + 1] === "'") i += 1;
      else if (ch === "'") single = false;
      continue;
    }
    if (double) {
      if (ch === '\\') i += 1;
      else if (ch === '"') double = false;
      continue;
    }
    if (ch === "'") single = true;
    else if (ch === '"') double = true;
    else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
};

const collectRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let directJobIndent: number | null = null;

  for (const raw of lines) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (jobsIndent === null) {
      const jobs = trimmed.match(/^(?:&[A-Za-z0-9_-]+\s+|![^\s]+\s+)*jobs\s*:\s*(?:(?:&[A-Za-z0-9_-]+|![^\s]+)\s*)*$/);
      if (jobs) {
        jobsIndent = indent;
        directJobIndent = null;
      }
      continue;
    }

    if (indent <= jobsIndent) {
      jobsIndent = null;
      directJobIndent = null;
      continue;
    }

    const directJobKey = trimmed.match(/^(?:(?:&[A-Za-z0-9_-]+|![^\s]+)\s+)*[A-Za-z0-9_-]+\s*:\s*(?:$|[^{}].*$|\{)/);
    if (directJobIndent === null && directJobKey) directJobIndent = indent;
    if (directJobIndent === null || indent !== directJobIndent) continue;

    const jobMatch = trimmed.match(/^(?:(?:&[A-Za-z0-9_-]+|![^\s]+)\s+)*[A-Za-z0-9_-]+\s*:\s*(?:(?:&[A-Za-z0-9_-]+|![^\s]+)\s+)*\{(.*)\}\s*$/);
    if (!jobMatch) continue;

    const uses = jobMatch[1].match(/(?:^|,)\s*uses\s*:\s*([^,}\s]+)\s*(?:,|$)/);
    if (uses) refs.push(uses[1]);
  }

  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(immutableRef.test(ref), `${source}: reusable workflow ref must use an immutable 40-character SHA: ${ref}`).toBe(true);
  }
};

describe('GitHub workflow top-level jobs node-property pinning policy', () => {
  it('enforces immutable refs for flow jobs under node-property-decorated jobs mappings', () => {
    const unsafe = [
      'jobs: &all',
      '  call: { uses: owner/repo/.github/workflows/build.yml@main }',
    ].join('\n');
    expect(() => expectPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts immutable refs and ignores nested uses-like mappings', () => {
    const safe = [
      'jobs: &all',
      '  call: { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    env: { uses: actions/checkout@v4 }',
    ].join('\n');
    expectPinned(safe, 'safe.yml');
  });

  it('derives direct job indentation from block-style job keys', () => {
    const safe = [
      'jobs: &all',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    env: { uses: actions/checkout@v4 }',
      '  call: { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectPinned(safe, 'safe.yml');
  });

  it('keeps every checked-in workflow pinned for this syntax', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
