import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const gollumPageName = /github\.event\.pages(?:\[(?:\d+|'[^']+'|"[^"]+")\]|\.\*)\.page_name/;
const shellSink = /\b(?:bash|sh)\s+-c\b|\beval\b|\bInvoke-Expression\b/i;

const runValues = (workflow: string) => {
  const values: string[] = [];
  const lines = workflow.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*-?\s*(?:"run"|'run'|run)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (/^[|>][+-]?[1-9]?$|^[|>][1-9][+-]?$/.test(value)) {
      const indent = lines[i].match(/^\s*/)?.[0].length ?? 0;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        const nextIndent = next.match(/^\s*/)?.[0].length ?? 0;
        if (next.trim() && nextIndent <= indent) break;
        body.push(next);
        i = j;
      }
      values.push(body.join('\n'));
    } else {
      values.push(value);
    }
  }

  return values;
};

const taintedGollumEnvNames = (workflow: string) => {
  const names = new Set<string>();

  for (const line of workflow.split('\n')) {
    const binding = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (binding && gollumPageName.test(binding[2])) {
      names.add(binding[1]);
    }
  }

  return names;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const runReadsEnvName = (run: string, name: string) => {
  const escaped = escapeRegExp(name);
  return new RegExp(`(?:\\$\\{?${escaped}\\}?|\\$env:${escaped}\\b|%${escaped}%)`, 'i').test(run);
};

const assertNoGollumPageShellExecution = (workflow: string) => {
  const taintedEnvNames = taintedGollumEnvNames(workflow);

  for (const run of runValues(workflow)) {
    const readsTaintedEnv = [...taintedEnvNames].some((name) => runReadsEnvName(run, name));
    if ((gollumPageName.test(run) || readsTaintedEnv) && shellSink.test(run)) {
      throw new Error('Untrusted gollum page_name reaches a shell execution sink');
    }
  }
};

describe('GitHub workflow gollum page-name shell policy', () => {
  it('rejects indexed wiki page names used as shell commands', () => {
    expect(() =>
      assertNoGollumPageShellExecution(`
name: unsafe-wiki-command
on: gollum
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: bash -c '${'${{ github.event.pages[0].page_name }}'}'
`),
    ).toThrow(/gollum page_name/);
  });

  it('rejects wildcard wiki page names used in a block shell command', () => {
    expect(() =>
      assertNoGollumPageShellExecution(`
name: unsafe-wiki-command-block
on: gollum
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: |
          bash -c "${'${{ join(github.event.pages.*.page_name, \' \') }}'}"
`),
    ).toThrow(/gollum page_name/);
  });

  it('rejects wiki page names routed through a step environment binding', () => {
    expect(() =>
      assertNoGollumPageShellExecution(`
name: unsafe-wiki-env-command
on: gollum
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - env:
          PAGE_NAME: ${'${{ github.event.pages[0].page_name }}'}
        run: bash -c "$PAGE_NAME"
`),
    ).toThrow(/gollum page_name/);
  });

  it('allows page names consumed as data outside a shell execution sink', () => {
    expect(() =>
      assertNoGollumPageShellExecution(`
name: safe-wiki-data
on: gollum
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: printf '%s\\n' "${'${{ github.event.pages[0].page_name }}'}"
`),
    ).not.toThrow();
  });

  it('allows environment-bound page names consumed as data', () => {
    expect(() =>
      assertNoGollumPageShellExecution(`
name: safe-wiki-env-data
on: gollum
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - env:
          PAGE_NAME: ${'${{ github.event.pages[0].page_name }}'}
        run: printf '%s\\n' "$PAGE_NAME"
`),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertNoGollumPageShellExecution(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
