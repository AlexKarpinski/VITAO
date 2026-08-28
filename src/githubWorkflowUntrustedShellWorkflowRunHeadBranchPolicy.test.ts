import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const workflowRunTextSource = /github\.event\.workflow_run\.(?:head_branch|display_title|head_repository\.description)|github\[['"]event['"]\]\[['"]workflow_run['"]\](?:\[['"](?:head_branch|display_title)['"]\]|\[['"]head_repository['"]\]\[['"]description['"]\])/;
const envReference = (name: string) =>
  new RegExp(`(?:\\$${name}(?![A-Za-z0-9_])|\\$\\{${name}(?:[^}]*)?\\}|%${name}%|\\$env:${name}(?![A-Za-z0-9_])|\\$\\{env:${name}\\}|\\$\\{\\{\\s*env\\.${name}\\s*\\}\\})`);

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

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

const collectWorkflowRunTextEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (match && workflowRunTextSource.test(match[2])) names.add(match[1]);
  }
  return names;
};

const expectNoWorkflowRunTextShellExecution = (workflow: string, source: string) => {
  if (!/workflow_run\s*:/.test(workflow)) return;
  const taintedEnv = collectWorkflowRunTextEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(workflowRunTextSource.test(script), `${source}: attacker-controlled workflow_run text reaches a shell run step`).toBe(false);
    for (const name of taintedEnv) {
      expect(envReference(name).test(script), `${source}: attacker-controlled workflow_run text reaches shell through env.${name}`).toBe(false);
    }
  }
};

describe('GitHub workflow_run text shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWorkflowRunTextShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct workflow_run head branch shell execution', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', `      - run: "bash -c '${'${{ github.event.workflow_run.head_branch }}'}'"`].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-head.yml')).toThrow();
  });

  it('rejects workflow_run head branch propagated through env', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      CMD: ${'${{ github.event.workflow_run.head_branch }}'}`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-head-env.yml')).toThrow();
  });

  it('rejects direct workflow_run display-title shell execution', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', `      - run: "bash -c '${'${{ github.event.workflow_run.display_title }}'}'"`].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-display-title.yml')).toThrow();
  });

  it('rejects workflow_run display-title propagated through env', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      CMD: ${'${{ github.event.workflow_run.display_title }}'}`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-display-title-env.yml')).toThrow();
  });

  it('rejects workflow_run head repository descriptions in shell execution', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', `      - run: "bash -c '${'${{ github.event.workflow_run.head_repository.description }}'}'"`].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-head-repo.yml')).toThrow();
  });

  it('rejects workflow_run head repository descriptions propagated through env', () => {
    const unsafe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      CMD: ${'${{ github.event.workflow_run.head_repository.description }}'}`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoWorkflowRunTextShellExecution(unsafe, 'workflow-run-head-repo-env.yml')).toThrow();
  });

  it('allows workflow_run workflows that use only constant shell commands', () => {
    const safe = ['on:', '  workflow_run:', '    workflows: [CI]', '    types: [completed]', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo safe'].join('\n');
    expectNoWorkflowRunTextShellExecution(safe, 'safe.yml');
  });
});
