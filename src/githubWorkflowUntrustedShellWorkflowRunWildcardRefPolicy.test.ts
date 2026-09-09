import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const wildcardPullRequestRef = /github\.event\.workflow_run\.pull_requests\.\*\.head\.(?:ref|label)/;

const collectRunValues = (workflow: string) => {
  const values: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?(?:run|["']run["'])\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const value = match[2].trim();
    if (/^[>|][+-]?\d*$/.test(value) || /^[>|]\d+[+-]?$/.test(value)) {
      const body: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childLine = lines[child];
        const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
        if (childLine.trim() && childIndent <= indent) break;
        if (childLine.trim()) body.push(childLine.trim());
        index = child;
      }
      values.push(body.join('\n'));
    } else {
      values.push(value);
    }
  }
  return values;
};

const expectNoWorkflowRunWildcardRefInShell = (workflow: string, source: string) => {
  for (const run of collectRunValues(workflow)) {
    expect(
      wildcardPullRequestRef.test(run),
      `${source}: workflow_run pull-request head ref/label reaches a shell run step`,
    ).toBe(false);
  }
};

describe('workflow_run wildcard pull-request ref shell policy', () => {
  it('rejects wildcarded workflow-run pull-request head refs in shell commands', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  privileged:',
      '    steps:',
      '      - run: bash -c "${{ join(github.event.workflow_run.pull_requests.*.head.ref, \' \') }}"',
    ].join('\n');

    expect(() => expectNoWorkflowRunWildcardRefInShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects wildcarded workflow-run pull-request head labels in block run scripts', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  privileged:',
      '    steps:',
      '      - run: |',
      '          bash -c "${{ join(github.event.workflow_run.pull_requests.*.head.label, \' \') }}"',
    ].join('\n');

    expect(() => expectNoWorkflowRunWildcardRefInShell(unsafe, 'unsafe-block.yml')).toThrow();
  });

  it('allows ordinary workflow-run metadata that is not used as an executable ref', () => {
    const safe = [
      'on: workflow_run',
      'jobs:',
      '  inspect:',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');

    expectNoWorkflowRunWildcardRefInShell(safe, 'safe.yml');
  });

  it('enforces the boundary across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWorkflowRunWildcardRefInShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});