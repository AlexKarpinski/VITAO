import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflowRunTextSource = /github\.event\.workflow_run\.(?:head_branch|display_title|pull_requests\[\d+\]\.head\.(?:ref|label)|head_repository\.(?:description|homepage))/;

const stripComment = (value: string) => {
  let single = false;
  let double = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (single) {
      if (char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") single = false;
      continue;
    }
    if (double) {
      if (char === '"' && value[index - 1] !== '\\') double = false;
      continue;
    }
    if (char === "'") single = true;
    else if (char === '"') double = true;
    else if (char === '#') return value.slice(0, index).trimEnd();
  }
  return value;
};

const hasWorkflowRunTrigger = (workflow: string) => {
  for (const raw of workflow.split('\n')) {
    const line = stripComment(raw).trim();
    if (/^["']?workflow_run["']?\s*:/.test(line)) return true;
    const on = line.match(/^["']?on["']?\s*:\s*(.+)$/);
    if (!on) continue;
    const value = on[1].trim();
    if (/^["']?workflow_run["']?$/.test(value)) return true;
    const flow = value.match(/^\[([\s\S]*)\]$/);
    if (flow && flow[1].split(',').some((item) => /^["']?workflow_run["']?$/.test(item.trim()))) return true;
  }
  return false;
};

const collectRunValues = (workflow: string) => workflow
  .split('\n')
  .map((line) => line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/)?.[1] ?? '')
  .filter(Boolean);

const expectNoScalarWorkflowRunTextShellExecution = (workflow: string, source: string) => {
  if (!hasWorkflowRunTrigger(workflow)) return;
  for (const run of collectRunValues(workflow)) {
    expect(
      workflowRunTextSource.test(run),
      `${source}: workflow_run attacker-controlled text reaches shell under scalar or flow trigger syntax`,
    ).toBe(false);
  }
};

describe('scalar and flow workflow_run trigger shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoScalarWorkflowRunTextShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects workflow_run text under scalar trigger syntax', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  inspect:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: "bash -c '${'${{ github.event.workflow_run.head_branch }}'}'"`,
    ].join('\n');
    expect(() => expectNoScalarWorkflowRunTextShellExecution(unsafe, 'scalar-workflow-run.yml')).toThrow();
  });

  it('rejects workflow_run text under flow trigger syntax', () => {
    const unsafe = [
      'on: [workflow_dispatch, workflow_run]',
      'jobs:',
      '  inspect:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: "bash -c '${'${{ github.event.workflow_run.display_title }}'}'"`,
    ].join('\n');
    expect(() => expectNoScalarWorkflowRunTextShellExecution(unsafe, 'flow-workflow-run.yml')).toThrow();
  });

  it('does not apply workflow_run classification to unrelated triggers', () => {
    const safe = [
      'on: workflow_dispatch',
      'jobs:',
      '  inspect:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: "echo '${'${{ github.event.workflow_run.head_branch }}'}'"`,
    ].join('\n');
    expectNoScalarWorkflowRunTextShellExecution(safe, 'unrelated-trigger.yml');
  });
});
