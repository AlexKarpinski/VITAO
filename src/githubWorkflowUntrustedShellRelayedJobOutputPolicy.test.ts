import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsDirectUntrustedEvent = (value: string) =>
  /github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalizeAccess(value));

type JobOutput = { job: string; output: string; value: string };

const collectJobOutputs = (workflow: string) => {
  const outputs: JobOutput[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobName: string | null = null;
  let jobIndent: number | null = null;
  let outputsIndent: number | null = null;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (jobsIndent === null) {
      if (/^jobs\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (indent <= jobsIndent) break;

    const job = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
    if (job && (jobIndent === null || indent === jobIndent)) {
      jobName = job[1];
      jobIndent = indent;
      outputsIndent = null;
      continue;
    }

    if (!jobName || jobIndent === null) continue;
    if (indent <= jobIndent) {
      jobName = null;
      jobIndent = null;
      outputsIndent = null;
      continue;
    }

    if (outputsIndent === null) {
      if (/^outputs\s*:\s*$/.test(trimmed)) outputsIndent = indent;
      continue;
    }
    if (indent <= outputsIndent) {
      outputsIndent = null;
      continue;
    }

    const output = trimmed.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (output) outputs.push({ job: jobName, output: output[1], value: normalizeAccess(output[2]) });
  }

  return outputs;
};

const collectTaintedJobOutputs = (workflow: string) => {
  const outputs = collectJobOutputs(workflow);
  const tainted = new Set<string>();

  for (const output of outputs) {
    if (containsDirectUntrustedEvent(output.value)) tainted.add(`${output.job}.${output.output}`);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const output of outputs) {
      const key = `${output.job}.${output.output}`;
      if (tainted.has(key)) continue;

      for (const source of tainted) {
        const [sourceJob, sourceOutput] = source.split('.');
        const escapedJob = sourceJob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedOutput = sourceOutput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`needs\.${escapedJob}\.outputs\.${escapedOutput}\b`).test(output.value)) {
          tainted.add(key);
          changed = true;
          break;
        }
      }
    }
  }

  return tainted;
};

const collectShellExecutedValues = (workflow: string) => {
  const values: string[] = [];
  const lines = workflow.split('\n');
  let blockIndent: number | null = null;
  let blockValue = '';

  const flushBlock = () => {
    if (blockIndent !== null) values.push(blockValue);
    blockIndent = null;
    blockValue = '';
  };

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (blockIndent !== null) {
      if (!trimmed || indent > blockIndent) {
        blockValue += `${line}\n`;
        continue;
      }
      flushBlock();
    }

    const match = line.match(/^\s*(?:-\s*)?(run|shell)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (/^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/.test(value)) {
      blockIndent = indent;
      continue;
    }
    values.push(value);
  }
  flushBlock();
  return values;
};

const expectNoRelayedJobOutputShell = (workflow: string) => {
  const tainted = collectTaintedJobOutputs(workflow);
  const shellValues = collectShellExecutedValues(workflow).map(normalizeAccess);

  for (const key of tainted) {
    const [job, output] = key.split('.');
    const escapedJob = job.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedOutput = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sink = new RegExp(`needs\.${escapedJob}\.outputs\.${escapedOutput}\b`);
    expect(
      shellValues.some((value) => sink.test(value)),
      `tainted or relayed job output ${key} reaches a shell-capable workflow`,
    ).toBe(false);
  }
};

describe('GitHub workflow relayed job-output policy', () => {
  it('rejects taint relayed through multiple job outputs', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  first:',
      '    outputs:',
      '      command: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo produce',
      '  relay:',
      '    needs: first',
      '    outputs:',
      '      command: ${{ needs.first.outputs.command }}',
      '    steps:',
      '      - run: echo relay',
      '  consumer:',
      '    needs: relay',
      '    steps:',
      '      - run: bash -c "${{ needs.relay.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoRelayedJobOutputShell(unsafe)).toThrow();
  });

  it('propagates relayed output taint to a fixed point', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  first:',
      '    outputs:',
      '      command: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo first',
      '  relay1:',
      '    needs: first',
      '    outputs:',
      '      command: ${{ needs.first.outputs.command }}',
      '    steps:',
      '      - run: echo relay1',
      '  relay2:',
      '    needs: relay1',
      '    outputs:',
      '      command: ${{ needs.relay1.outputs.command }}',
      '    steps:',
      '      - run: echo relay2',
      '  consumer:',
      '    needs: relay2',
      '    steps:',
      '      - run: bash -c "${{ needs.relay2.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoRelayedJobOutputShell(unsafe)).toThrow();
  });

  it('accepts a constant relay output', () => {
    const safe = [
      'on: issue_comment',
      'jobs:',
      '  first:',
      '    outputs:',
      '      message: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo first',
      '  relay:',
      '    needs: first',
      '    outputs:',
      '      command: echo-safe',
      '    steps:',
      '      - run: echo relay',
      '  consumer:',
      '    needs: relay',
      '    steps:',
      '      - run: bash -c "${{ needs.relay.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoRelayedJobOutputShell(safe)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoRelayedJobOutputShell(readFileSync(join('.github/workflows', name), 'utf8'));
    }
  });
});
