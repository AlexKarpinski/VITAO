import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const untrustedCommitMessage = /github\.event\.(?:workflow_run\.)?head_commit\.message\b/;

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = raw.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (!blockHeader.test(value)) {
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

const collectCommitMessageEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    if (untrustedCommitMessage.test(normalizeAccess(match[2]))) names.add(match[1]);
  }
  return names;
};

const shellReferencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`,
    'i',
  ).test(script);
};

const expectNoCommitMessageShell = (workflow: string, source: string) => {
  const scripts = collectRunScripts(workflow);
  const taintedEnv = collectCommitMessageEnvNames(workflow);
  for (const script of scripts) {
    expect(
      untrustedCommitMessage.test(normalizeAccess(script)),
      `${source}: attacker-controlled commit message reaches shell`,
    ).toBe(false);
    for (const name of taintedEnv) {
      expect(
        shellReferencesEnv(script, name),
        `${source}: commit-message environment ${name} reaches shell`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow commit-message shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoCommitMessageShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct head commit messages in shell scripts', () => {
    const unsafe = [
      'on: push',
      'jobs:',
      '  demo:',
      '    steps:',
      `      - run: "bash -c '\${{ github.event.head_commit.message }}'"`,
    ].join('\n');
    expect(() => expectNoCommitMessageShell(unsafe, 'push.yml')).toThrow();
  });

  it('rejects workflow-run head commit messages in block shell scripts', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  demo:',
      '    steps:',
      '      - run: |',
      `          bash -c '\${{ github.event.workflow_run.head_commit.message }}'`,
    ].join('\n');
    expect(() => expectNoCommitMessageShell(unsafe, 'workflow-run.yml')).toThrow();
  });

  it('rejects bracketed commit-message access', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  demo:',
      '    steps:',
      `      - run: "bash -c '\${{ github['event']['workflow_run']['head_commit']['message'] }}'"`,
    ].join('\n');
    expect(() => expectNoCommitMessageShell(unsafe, 'bracketed.yml')).toThrow();
  });

  it('rejects commit-message taint routed through environment variables', () => {
    const unsafe = [
      'on: workflow_run',
      'jobs:',
      '  demo:',
      '    env:',
      `      CMD: "\${{ github.event.workflow_run.head_commit.message }}"`,
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoCommitMessageShell(unsafe, 'env.yml')).toThrow();
  });

  it('allows constant shell scripts', () => {
    const safe = ['jobs:', '  demo:', '    steps:', '      - run: echo safe'].join('\n');
    expectNoCommitMessageShell(safe, 'safe.yml');
  });
});
