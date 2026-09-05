import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

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

const isPullRequestContext = (workflow: string) =>
  /(?:pull_request_target|pull_request)\s*:/.test(workflow);

const referencesHeadRef = (script: string) => {
  const normalized = script.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
  return /(?:\$GITHUB_HEAD_REF|\$\{GITHUB_HEAD_REF\}|%GITHUB_HEAD_REF%|\$env:GITHUB_HEAD_REF|\$\{env:GITHUB_HEAD_REF\}|\$\{\{\s*env\.GITHUB_HEAD_REF\s*\}\}|\$\{\{\s*github\.head_ref\s*\}\}|\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\})/.test(normalized);
};

const expectNoHeadRefShellExecution = (workflow: string, source: string) => {
  if (!isPullRequestContext(workflow)) return;
  for (const script of collectRunScripts(workflow)) {
    expect(referencesHeadRef(script), `${source}: attacker-controlled pull-request head ref reaches a shell run step`).toBe(false);
  }
};

describe('GitHub workflow GITHUB_HEAD_REF shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoHeadRefShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects GITHUB_HEAD_REF in pull_request_target shell execution', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: bash -c "$GITHUB_HEAD_REF"',
    ].join('\n');
    expect(() => expectNoHeadRefShellExecution(unsafe, 'head-ref.yml')).toThrow();
  });

  it('rejects pull-request head-ref expressions in privileged shell execution', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ github.event.pull_request.head.ref }}'",
      "      - run: bash -c '${{ github['event']['pull_request']['head']['ref'] }}'",
    ].join('\n');
    expect(() => expectNoHeadRefShellExecution(unsafe, 'head-ref-expression.yml')).toThrow();
  });

  it('rejects top-level github.head_ref in privileged shell execution', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ github.head_ref }}'",
      "      - run: bash -c '${{ github['head_ref'] }}'",
    ].join('\n');
    expect(() => expectNoHeadRefShellExecution(unsafe, 'top-level-head-ref.yml')).toThrow();
  });

  it('rejects block-scalar GITHUB_HEAD_REF shell execution', () => {
    const unsafe = [
      'on:',
      '  pull_request:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      '          bash -c "${GITHUB_HEAD_REF}"',
    ].join('\n');
    expect(() => expectNoHeadRefShellExecution(unsafe, 'head-ref-block.yml')).toThrow();
  });

  it('does not treat a constant shell command as unsafe', () => {
    const safe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectNoHeadRefShellExecution(safe, 'safe.yml');
  });
});
