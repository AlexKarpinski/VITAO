import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const extractJobs = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs = new Map<string, string>();
  let jobsIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = getIndent(line);

    if (jobsIndent === null) {
      if (/^jobs\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (trimmed && indent <= jobsIndent) break;

    const jobMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
    if (!jobMatch || indent <= jobsIndent) continue;

    const block = [line];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && getIndent(childLine) <= indent) break;
      block.push(childLine);
      index = child;
    }
    jobs.set(jobMatch[1], block.join('\n'));
  }

  return jobs;
};

const taintedStepIds = (job: string) => {
  const ids = new Set<string>();
  const blocks = job.split(/\n(?=\s*-\s+)/);
  for (const block of blocks) {
    const id = block.match(/^\s*-?\s*id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/m)?.[1];
    if (id && isUntrusted(block)) ids.add(id);
  }
  return ids;
};

const taintedJobOutputs = (workflow: string) => {
  const outputs = new Set<string>();
  for (const [jobName, job] of extractJobs(workflow)) {
    const stepIds = taintedStepIds(job);
    for (const line of job.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
      if (!match) continue;
      const [, outputName, rawValue] = match;
      const value = normalizeAccess(rawValue);
      if (isUntrusted(value)) outputs.add(`${jobName}.${outputName}`);
      for (const stepId of stepIds) {
        const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`steps\\.${escaped}\\.outputs\\.[A-Za-z_][A-Za-z0-9_-]*\\b`).test(value)) {
          outputs.add(`${jobName}.${outputName}`);
        }
      }
    }
  }
  return outputs;
};

const runValues = (job: string) => job.split('\n')
  .map((line) => line.match(/^\s*(?:-\s*)?run\s*:\s*(.+)$/)?.[1])
  .filter((value): value is string => Boolean(value));

const expectNoBracketedNeedsBypass = (workflow: string) => {
  const jobs = extractJobs(workflow);
  const outputs = taintedJobOutputs(workflow);

  for (const [consumerName, job] of jobs) {
    const normalizedJob = normalizeAccess(job);
    for (const key of outputs) {
      const [producer, output] = key.split('.');
      const escapedProducer = producer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedOutput = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reference = new RegExp(`needs\\.${escapedProducer}\\.outputs\\.${escapedOutput}\\b`);
      if (!reference.test(normalizedJob)) continue;

      for (const run of runValues(job)) {
        expect(reference.test(normalizeAccess(run)), `${consumerName}: tainted job output reaches run through bracket access`).toBe(false);
      }
    }
  }
};

describe('GitHub workflow bracketed needs-output policy', () => {
  it('rejects bracket-form access to a tainted job output', () => {
    const unsafe = [
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: ${{ steps.capture.outputs.result }}',
      '    steps:',
      '      - id: capture',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: return context.payload.comment.body',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      `      - run: bash -c "\${{ needs['producer'].outputs.command }}"`,
    ].join('\n');

    expect(() => expectNoBracketedNeedsBypass(unsafe)).toThrow();
  });

  it('accepts bracket-form access to an unrelated constant output', () => {
    const safe = [
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: echo-safe',
      '    steps:',
      '      - run: echo safe',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      `      - run: echo "\${{ needs['producer'].outputs.command }}"`,
    ].join('\n');

    expect(() => expectNoBracketedNeedsBypass(safe)).not.toThrow();
  });

  it('enforces the bracketed-needs boundary across checked-in workflows', () => {
    for (const name of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, name), 'utf8');
      expectNoBracketedNeedsBypass(workflow);
    }
  });
});
