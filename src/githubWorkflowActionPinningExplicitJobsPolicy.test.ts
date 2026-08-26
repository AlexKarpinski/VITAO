import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[,}]\s*$/, '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const collectExplicitJobsWorkflowRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let explicitJobsIndent: number | null = null;
  let jobsValueIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (/^\?\s+(?:jobs|["']jobs["'])\s*$/.test(trimmed)) {
      explicitJobsIndent = indent;
      jobsValueIndent = null;
      continue;
    }

    if (explicitJobsIndent !== null && jobsValueIndent === null) {
      if (!trimmed) continue;
      if (indent < explicitJobsIndent || !/^:\s*$/.test(trimmed)) {
        explicitJobsIndent = null;
        continue;
      }
      jobsValueIndent = indent;
      continue;
    }

    if (jobsValueIndent === null) continue;
    if (!trimmed) continue;
    if (indent <= jobsValueIndent) {
      explicitJobsIndent = null;
      jobsValueIndent = null;
      continue;
    }

    const flowJob = trimmed.match(/^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([\s\S]*)\}\s*$/);
    if (!flowJob) continue;
    const uses = flowJob[1].match(/(?:^|,)\s*(?:uses|["']uses["'])\s*:\s*([^,}]+)/);
    if (uses) refs.push(unquote(uses[1]));
  }

  return refs;
};

const expectImmutableExplicitJobsRefs = (workflow: string, source: string) => {
  for (const ref of collectExplicitJobsWorkflowRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('explicit top-level jobs immutable-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableExplicitJobsRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('enforces reusable-workflow pins below an explicit jobs key', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectImmutableExplicitJobsRefs(pinned, 'explicit-jobs.yml');

    const mutable = ['? jobs', ':', '  call: { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableExplicitJobsRefs(mutable, 'explicit-jobs.yml')).toThrow();
  });

  it('does not treat nested uses-like metadata as a reusable-workflow ref', () => {
    const safe = ['? jobs', ':', '  build: { runs-on: ubuntu-latest, env: { uses: actions/checkout@v4 } }'].join('\n');
    expect(collectExplicitJobsWorkflowRefs(safe)).toEqual([]);
    expectImmutableExplicitJobsRefs(safe, 'explicit-jobs-metadata.yml');
  });
});
