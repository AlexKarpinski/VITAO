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

const assertNoGollumPageShellExecution = (workflow: string) => {
  for (const run of runValues(workflow)) {
    if (gollumPageName.test(run) && shellSink.test(run)) {
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

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertNoGollumPageShellExecution(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
