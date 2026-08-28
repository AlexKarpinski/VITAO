import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const decodeYamlKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};

const normalizeAccess = (value: string) =>
  value.replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedEventText = (value: string) => {
  const normalized = normalizeAccess(value);
  return [
    'github.event.issue.title',
    'github.event.issue.body',
    'github.event.comment.body',
    'github.event.pull_request.title',
    'github.event.pull_request.body',
    'github.event.review.body',
    'github.event.review_comment.body',
  ].some((path) => normalized.includes(path));
};

const collectTaintedQuotedEnvKeys = (workflow: string) => {
  const tainted = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*((?:"(?:\\.|[^"])+")|(?:'(?:''|[^'])+')|(?:[A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.*)$/);
    if (!match || !containsUntrustedEventText(match[2])) continue;
    const key = decodeYamlKey(match[1]);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) tainted.add(key);
  }
  return tainted;
};

const collectRunValues = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?(?:run|["']run["'])\s*:\s*(.*)$/)?.[1])
    .filter((value): value is string => Boolean(value));

const runReferencesEnv = (run: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = normalizeAccess(run);
  return new RegExp(
    `(?:\\$${escaped}\\b|\\$\\{${escaped}(?:[^}]*)?\\}|\\$env:${escaped}\\b|\\$\\{env:${escaped}\\}|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`,
    'i',
  ).test(normalized);
};

const assertNoQuotedEnvShellFlow = (workflow: string, source: string) => {
  const tainted = collectTaintedQuotedEnvKeys(workflow);
  for (const run of collectRunValues(workflow)) {
    for (const name of tainted) {
      expect(runReferencesEnv(run, name), `${source}: tainted quoted env key ${name} reaches run`).toBe(false);
    }
  }
};

describe('GitHub workflow quoted environment-key shell policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertNoQuotedEnvShellFlow(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects double-quoted and single-quoted tainted environment keys', () => {
    const unsafe = [
      'env:',
      '  "CMD": ${{ github.event.comment.body }}',
      "  'OTHER': ${{ github.event.issue.body }}",
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertNoQuotedEnvShellFlow(unsafe, 'quoted-env.yml')).toThrow();
  });

  it('decodes escaped quoted environment keys before taint analysis', () => {
    const unsafe = [
      'env:',
      '  "C\\u004dD": ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertNoQuotedEnvShellFlow(unsafe, 'escaped-env.yml')).toThrow();
  });

  it('allows a quoted environment key when its value is constant', () => {
    const safe = ['env:', '  "CMD": echo safe', 'steps:', '  - run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoQuotedEnvShellFlow(safe, 'safe.yml')).not.toThrow();
  });
});
