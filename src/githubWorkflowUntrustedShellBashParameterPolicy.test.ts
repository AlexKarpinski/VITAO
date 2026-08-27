import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const untrustedEventText = /github\.event\.(?:issue|comment|pull_request|discussion)\.(?:title|body)\b/;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

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

const collectTaintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    if (untrustedEventText.test(normalizeAccess(match[2]))) names.add(match[1]);
  }
  return names;
};

const bashParameterReferences = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\$\\{${escaped}(?::[^}]*)?\\}`, 'g').test(script);
};

const expectNoTaintedBashParameterExpansion = (workflow: string, source: string) => {
  const taintedEnv = collectTaintedEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    for (const name of taintedEnv) {
      expect(
        bashParameterReferences(script, name),
        `${source}: tainted environment ${name} reaches Bash parameter expansion`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow Bash parameter-expansion shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoTaintedBashParameterExpansion(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects substring expansion of an attacker-controlled variable', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  demo:',
      '    env:',
      `      CMD: "\${{ github.event.comment.body }}"`,
      '    steps:',
      '      - run: bash -c "${CMD:0}"',
    ].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'substring.yml')).toThrow();
  });

  it('rejects default and replacement parameter operators too', () => {
    const unsafe = [
      'on: issues',
      'jobs:',
      '  demo:',
      '    env:',
      `      CMD: "\${{ github.event.issue.body }}"`,
      '    steps:',
      '      - run: bash -c "${CMD:-echo safe}"',
    ].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'operator.yml')).toThrow();
  });

  it('allows parameter expansion of constant environment values', () => {
    const safe = ['jobs:', '  demo:', '    env:', '      CMD: echo-safe', '    steps:', '      - run: printf "%s" "${CMD:0}"'].join('\n');
    expectNoTaintedBashParameterExpansion(safe, 'safe.yml');
  });
});
