import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflowRunHeadLabelSource = /github\.event\.workflow_run\.pull_requests\[\d+\]\.head\.label|github\[['"]event['"]\]\[['"]workflow_run['"]\]\[['"]pull_requests['"]\]\[\d+\]\[['"]head['"]\]\[['"]label['"]\]/;
const envReference = (name: string) =>
  new RegExp(`(?:\\$${name}(?![A-Za-z0-9_])|\\$\\{${name}(?:[^}]*)?\\}|%${name}%|\\$env:${name}(?![A-Za-z0-9_])|\\$\\{env:${name}\\}|\\$\\{\\{\\s*env\\.${name}\\s*\\}\\})`);

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const onKey = String.raw`(?:on|"on"|'on')`;
const hasWorkflowRunTrigger = (workflow: string) =>
  /^\s*workflow_run\s*:/m.test(workflow) ||
  new RegExp(`^\\s*${onKey}\\s*:\\s*workflow_run\\s*(?:#.*)?$`, 'm').test(workflow) ||
  new RegExp(`^\\s*${onKey}\\s*:\\s*\\[[^\\]\\n]*\\bworkflow_run\\b[^\\]\\n]*\\]\\s*(?:#.*)?$`, 'm').test(workflow) ||
  new RegExp(`^\\s*${onKey}\\s*:\\s*\\{[^}\\n]*\\bworkflow_run\\s*:[^}\\n]*\\}\\s*(?:#.*)?$`, 'm').test(workflow);

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = raw.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (!scalarHeader.test(value)) {
      scripts.push(value);
      continue;
    }
    const parentIndent = indentOf(raw);
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && indentOf(childLine) <= parentIndent) break;
      body.push(childLine.trim());
      index = child;
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
};

const collectTaintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (match && workflowRunHeadLabelSource.test(match[2])) names.add(match[1]);
  }
  return names;
};

const expectNoWorkflowRunHeadLabelShellExecution = (workflow: string, source: string) => {
  if (!hasWorkflowRunTrigger(workflow)) return;
  const taintedEnv = collectTaintedEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(workflowRunHeadLabelSource.test(script), `${source}: workflow_run pull-request head label reaches a shell run step`).toBe(false);
    for (const name of taintedEnv) {
      expect(envReference(name).test(script), `${source}: workflow_run pull-request head label reaches shell through env.${name}`).toBe(false);
    }
  }
};

describe('GitHub workflow_run pull-request head-label shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWorkflowRunHeadLabelShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects workflow_run pull-request head labels propagated through env', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      CMD: ${'${{ github.event.workflow_run.pull_requests[0].head.label }}'}`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoWorkflowRunHeadLabelShellExecution(unsafe, 'workflow-run-head-label-env.yml')).toThrow();
  });

  it('rejects bracket-access workflow_run pull-request head labels in shell execution', () => {
    const unsafe = ['"on": workflow_run', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', `      - run: "bash -c '${'${{ github[\'event\'][\'workflow_run\'][\'pull_requests\'][0][\'head\'][\'label\'] }}'}'"`].join('\n');
    expect(() => expectNoWorkflowRunHeadLabelShellExecution(unsafe, 'workflow-run-head-label-bracket.yml')).toThrow();
  });

  it('allows workflow_run head labels used only as data', () => {
    const safe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      LABEL: ${'${{ github.event.workflow_run.pull_requests[0].head.label }}'}`, '    steps:', '      - run: echo safe'].join('\n');
    expectNoWorkflowRunHeadLabelShellExecution(safe, 'workflow-run-head-label-data.yml');
  });
});
