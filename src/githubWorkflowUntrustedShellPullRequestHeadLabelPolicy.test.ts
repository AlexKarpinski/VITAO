import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const headLabelSource = /github\.event\.pull_request\.head\.label|github\[['"]event['"]\]\[['"]pull_request['"]\]\[['"]head['"]\]\[['"]label['"]\]|context\.payload\.pull_request\.head\.label|context\.payload\.pull_request\?\.head\?\.label/;
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

const collectHeadLabelEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (match && headLabelSource.test(match[2])) names.add(match[1]);
  }
  return names;
};

const expectNoPullRequestHeadLabelShellExecution = (workflow: string, source: string) => {
  if (!/pull_request_target\s*:/.test(workflow) && !/pull_request\s*:/.test(workflow)) return;
  const taintedEnv = collectHeadLabelEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(headLabelSource.test(script), `${source}: pull_request.head.label reaches a shell run step`).toBe(false);
    for (const name of taintedEnv) {
      expect(envReference(name).test(script), `${source}: pull_request.head.label reaches shell through env.${name}`).toBe(false);
    }
  }
};

describe('GitHub pull request head label shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoPullRequestHeadLabelShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct pull_request_target head label shell execution', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: "bash -c '${'${{ github.event.pull_request.head.label }}'}'"`,
    ].join('\n');
    expect(() => expectNoPullRequestHeadLabelShellExecution(unsafe, 'pr-head-label.yml')).toThrow();
  });

  it('rejects pull request head label propagated through env', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    env:',
      `      CMD: ${'${{ github.event.pull_request.head.label }}'}`,
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoPullRequestHeadLabelShellExecution(unsafe, 'pr-head-label-env.yml')).toThrow();
  });

  it('allows pull request workflows that use only constant shell commands', () => {
    const safe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectNoPullRequestHeadLabelShellExecution(safe, 'safe.yml');
  });
});
