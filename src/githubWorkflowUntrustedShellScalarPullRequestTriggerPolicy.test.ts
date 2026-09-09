import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const pullRequestEvents = new Set(['pull_request', 'pull_request_target']);

const decodeScalar = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const hasPullRequestTrigger = (workflow: string) => {
  for (const raw of workflow.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const scalar = line.match(/^on\s*:\s*([^\[{].*?)\s*$/);
    if (scalar && pullRequestEvents.has(decodeScalar(scalar[1]))) return true;

    const flow = line.match(/^on\s*:\s*\[(.*)\]\s*$/);
    if (flow) {
      const events = flow[1].split(',').map((event) => decodeScalar(event));
      if (events.some((event) => pullRequestEvents.has(event))) return true;
    }

    const block = line.match(/^(?:pull_request|pull_request_target)\s*:/);
    if (block) return true;
  }
  return false;
};

const referencesPullRequestHeadRef = (workflow: string) => {
  const normalized = workflow.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
  return /\$\{\{\s*github\.(?:head_ref|event\.pull_request\.head\.ref)\s*\}\}|\$GITHUB_HEAD_REF|\$\{GITHUB_HEAD_REF\}|%GITHUB_HEAD_REF%|\$env:GITHUB_HEAD_REF/.test(normalized);
};

const expectNoScalarTriggeredHeadRefShell = (workflow: string, source: string) => {
  if (!hasPullRequestTrigger(workflow)) return;
  const runLines = workflow.split('\n').filter((line) => /^\s*(?:-\s*)?["']?run["']?\s*:/.test(line));
  for (const runLine of runLines) {
    expect(referencesPullRequestHeadRef(runLine), `${source}: pull-request head ref reaches a shell run step`).toBe(false);
  }
};

describe('scalar pull-request trigger shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoScalarTriggeredHeadRefShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects github.head_ref under a scalar pull_request trigger', () => {
    const unsafe = [
      'on: pull_request',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ github.head_ref }}'",
    ].join('\n');
    expect(() => expectNoScalarTriggeredHeadRefShell(unsafe, 'scalar-pr.yml')).toThrow();
  });

  it('rejects pull-request head refs under a flow trigger list', () => {
    const unsafe = [
      'on: [workflow_dispatch, pull_request_target]',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ github.event.pull_request.head.ref }}'",
    ].join('\n');
    expect(() => expectNoScalarTriggeredHeadRefShell(unsafe, 'flow-pr.yml')).toThrow();
  });

  it('does not apply the pull-request head-ref policy to a push-only trigger', () => {
    const safe = [
      'on: push',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: echo '${{ github.head_ref }}'",
    ].join('\n');
    expectNoScalarTriggeredHeadRefShell(safe, 'push-only.yml');
  });
});
