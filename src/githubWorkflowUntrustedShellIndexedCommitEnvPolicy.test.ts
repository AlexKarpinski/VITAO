import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const indexedCommitMetadata = /github\s*\.\s*event\s*\.\s*commits\s*\[\s*\d+\s*\]\s*\.\s*(?:message|author\s*\.\s*(?:name|email)|committer\s*\.\s*(?:name|email)|(?:added|removed|modified)\s*\[)/;

const collectIndexedCommitEnv = (workflow: string) => {
  const tainted = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const line of lines) {
    const indent = indentOf(line);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^(?:"env"|'env'|env)\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }

    if (envIndent === null) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }

    const match = trimmed.match(/^(?:"([A-Za-z_][A-Za-z0-9_]*)"|'([A-Za-z_][A-Za-z0-9_]*)'|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.+)$/);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3];
    const value = match[4];
    if (indexedCommitMetadata.test(value)) tainted.add(name);
  }

  return tainted;
};

const collectRunValues = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^(?:-\s*)?(?:"run"|'run'|run)\s*:\s*(.+)$/);
      return match ? [match[1]] : [];
    });

const executesTaintedEnv = (script: string, tainted: Set<string>) => {
  if (!/(?:bash|sh|zsh|dash|ksh)\s+-c\b|\beval\b|Invoke-Expression/i.test(script)) return false;
  for (const name of tainted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (
      new RegExp(`\\$${escaped}\\b|\\$\\{${escaped}(?:\\}|[:/#%])|\\$env:${escaped}\\b|%${escaped}%`, 'i').test(script)
    ) {
      return true;
    }
  }
  return false;
};

const assertIndexedCommitEnvSafe = (workflow: string) => {
  const tainted = collectIndexedCommitEnv(workflow);
  for (const run of collectRunValues(workflow)) {
    expect(executesTaintedEnv(run, tainted), `Indexed commit metadata reaches shell execution: ${run}`).toBe(false);
  }
};

describe('GitHub workflow indexed commit metadata environment policy', () => {
  it('rejects indexed commit messages executed through an environment variable', () => {
    expect(() =>
      assertIndexedCommitEnvSafe(`
name: unsafe-indexed-commit-env
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      CMD: \${{ github.event.commits[0].message }}
    steps:
      - run: bash -c "$CMD"
`),
    ).toThrow(/Indexed commit metadata reaches shell execution/);
  });

  it('accepts indexed commit metadata used only as data', () => {
    expect(() =>
      assertIndexedCommitEnvSafe(`
name: safe-indexed-commit-env
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      MESSAGE: \${{ github.event.commits[0].message }}
    steps:
      - run: printf '%s\\n' "$MESSAGE"
`),
    ).not.toThrow();
  });

  it('does not taint unrelated constant environment variables', () => {
    expect(() =>
      assertIndexedCommitEnvSafe(`
name: constant-env
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      CMD: echo safe
    steps:
      - run: bash -c "$CMD"
`),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertIndexedCommitEnvSafe(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
