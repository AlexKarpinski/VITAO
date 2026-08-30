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
  /github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.body)/.test(normalizeAccess(value));

const collectDirectTaintedOutputs = (workflow: string) => {
  const tainted = new Set<string>();
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

    if (jobIndent === null || indent === jobIndent) {
      const job = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
      if (job) {
        jobName = job[1];
        jobIndent = indent;
        outputsIndent = null;
        continue;
      }
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
    if (output && containsDirectUntrustedEvent(output[2])) tainted.add(`${jobName}.${output[1]}`);
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

const expectNoDirectEventJobOutputShell = (workflow: string) => {
  const tainted = collectDirectTaintedOutputs(workflow);
  const shellValues = collectShellExecutedValues(workflow);
  for (const key of tainted) {
    const [job, output] = key.split('.');
    const escapedJob = job.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedOutput = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const directSink = new RegExp(`needs(?:\\.${escapedJob}|\\[['"]${escapedJob}['"]\\])\\.outputs(?:\\.${escapedOutput}|\\[['"]${escapedOutput}['"]\\])`);
    const wildcardSink = new RegExp(`needs\\.\\*\\.outputs(?:\\.${escapedOutput}|\\[['"]${escapedOutput}['"]\\])`);
    expect(
      shellValues.some((value) => directSink.test(value) || wildcardSink.test(value)),
      `tainted job output ${key} reaches a downstream shell-capable workflow`,
    ).toBe(false);
  }
};

describe('GitHub workflow direct event job-output policy', () => {
  it('rejects direct event text propagated through a job output', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo produce',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      '      - run: bash -c "${{ needs.producer.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoDirectEventJobOutputShell(unsafe)).toThrow();
  });

  it('rejects wildcard aggregation of a tainted job output', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo produce',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      "      - run: bash -c \"${{ join(needs.*.outputs.command, ' ') }}\"",
    ].join('\n');
    expect(() => expectNoDirectEventJobOutputShell(unsafe)).toThrow();
  });

  it('accepts wildcard aggregation of an unrelated constant output', () => {
    const safe = [
      'on: issue_comment',
      'jobs:',
      '  producer:',
      '    outputs:',
      '      message: ${{ github.event.comment.body }}',
      '      command: echo-safe',
      '    steps:',
      '      - run: echo produce',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      "      - run: printf '%s\\n' \"${{ join(needs.*.outputs.command, ' ') }}\"",
    ].join('\n');
    expect(() => expectNoDirectEventJobOutputShell(safe)).not.toThrow();
  });

  it('accepts tainted job outputs consumed only by github-script', () => {
    const safe = [
      'on: issue_comment',
      'jobs:',
      '  producer:',
      '    outputs:',
      '      message: ${{ github.event.comment.body }}',
      '    steps:',
      '      - run: echo produce',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        env:',
      '          MESSAGE: ${{ needs.producer.outputs.message }}',
      '        with:',
      '          script: core.info(process.env.MESSAGE)',
    ].join('\n');
    expect(() => expectNoDirectEventJobOutputShell(safe)).not.toThrow();
  });

  it('accepts constant job outputs', () => {
    const safe = [
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: echo-safe',
      '    steps:',
      '      - run: echo produce',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      '      - run: bash -c "${{ needs.producer.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoDirectEventJobOutputShell(safe)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoDirectEventJobOutputShell(readFileSync(join('.github/workflows', name), 'utf8'));
    }
  });
});
