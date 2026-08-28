import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();
const immutable = /^[^\s@]+@(?:[0-9a-fA-F]{40})$/;

const refsFromExplicitInlineJobs = (workflow: string) => {
  const refs: string[] = [];
  for (const line of workflow.split('\n')) {
    const jobs = line.match(/^\s*jobs\s*:\s*\{(.*)\}\s*$/);
    if (!jobs) continue;
    const body = jobs[1];
    const explicitJob = /(?:^|,)\s*\?\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([^{}]*)\}/g;
    for (const match of body.matchAll(explicitJob)) {
      const uses = match[1].match(/(?:^|,)\s*uses\s*:\s*([^,}\s]+)/);
      if (uses) refs.push(uses[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const assertPinned = (workflow: string) => {
  for (const ref of refsFromExplicitInlineJobs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `mutable reusable workflow ref: ${ref}`).toMatch(immutable);
  }
};

describe('explicit inline job-key action pinning policy', () => {
  it('rejects mutable reusable workflows behind explicit inline job ids', () => {
    expect(() => assertPinned('jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@main } }')).toThrow();
  });

  it('accepts immutable reusable workflow refs', () => {
    expect(() => assertPinned('jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 } }')).not.toThrow();
  });

  it('enforces every checked-in workflow', () => {
    for (const file of workflowFiles) assertPinned(readFileSync(join(workflowsDir, file), 'utf8'));
  });
});
