import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const headRefExpression = /\$\{\{\s*(?:github\.head_ref|github\.event\.pull_request\.head\.ref)\s*\}\}/;

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

const collectJobs = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs: string[] = [];
  const jobsIndex = lines.findIndex((line) => /^\s*["']?jobs["']?\s*:\s*$/.test(line));
  if (jobsIndex < 0) return jobs;
  const jobsIndent = indentOf(lines[jobsIndex]);
  let currentStart = -1;
  let jobIndent: number | null = null;

  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (trimmed && indent <= jobsIndent) {
      if (currentStart >= 0) jobs.push(lines.slice(currentStart, index).join('\n'));
      currentStart = -1;
      break;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    const isMappingKey = /^\s*[A-Za-z0-9_.-]+\s*:\s*(?:#.*)?$/.test(raw);
    if (jobIndent === null && isMappingKey) jobIndent = indent;
    if (jobIndent !== null && indent === jobIndent && isMappingKey) {
      if (currentStart >= 0) jobs.push(lines.slice(currentStart, index).join('\n'));
      currentStart = index;
    }
  }
  if (currentStart >= 0) jobs.push(lines.slice(currentStart).join('\n'));
  return jobs;
};

const collectTaintedEnvNames = (job: string) => {
  const names = new Set<string>();
  const lines = job.split('\n');
  let envIndent: number | null = null;
  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^(?:-\s*)?["']?env["']?\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }
    if (envIndent === null) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }
    const assignment = trimmed.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (assignment && headRefExpression.test(assignment[2])) names.add(assignment[1]);
  }
  return names;
};

const reachesShellCommand = (script: string, name: string) => {
  const envRef = `(?:\\$${name}\\b|\\$\\{${name}\\}|%${name}%|\\$env:${name}\\b)`;
  return new RegExp(`(?:bash|sh|dash|ksh|zsh)\\s+-c\\s+[^\\n]*${envRef}`, 'i').test(script)
    || new RegExp(`(?:eval|Invoke-Expression|iex)\\s+[^\\n]*${envRef}`, 'i').test(script)
    || new RegExp(`(?:cmd(?:\\.exe)?\\s+/c|powershell(?:\\.exe)?\\s+(?:-Command|-c)|pwsh\\s+(?:-Command|-c))\\s+[^\\n]*${envRef}`, 'i').test(script);
};

const expectNoHeadRefEnvShellExecution = (workflow: string, source: string) => {
  if (!/(?:pull_request_target|pull_request)\s*:/.test(workflow)) return;
  for (const job of collectJobs(workflow)) {
    const tainted = collectTaintedEnvNames(job);
    if (tainted.size === 0) continue;
    for (const script of collectRunScripts(job)) {
      for (const name of tainted) {
        expect(reachesShellCommand(script, name), `${source}: pull-request head ref propagated through env.${name} reaches shell command execution`).toBe(false);
      }
    }
  }
};

describe('GitHub workflow pull-request head-ref env propagation policy', () => {
  it('rejects pull-request head ref propagated through env into bash -c', () => {
    const unsafe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    env:',
      '      CMD: ${{ github.event.pull_request.head.ref }}',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoHeadRefEnvShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects top-level github.head_ref propagated through step env', () => {
    const unsafe = [
      'on:',
      '  pull_request:',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - env:',
      '          COMMAND: ${{ github.head_ref }}',
      '        run: sh -c "${COMMAND}"',
    ].join('\n');
    expect(() => expectNoHeadRefEnvShellExecution(unsafe, 'step-env.yml')).toThrow();
  });

  it('does not leak env taint across sibling jobs', () => {
    const safe = [
      'on:',
      '  pull_request_target:',
      'jobs:',
      '  producer:',
      '    runs-on: ubuntu-latest',
      '    env:',
      '      CMD: ${{ github.event.pull_request.head.ref }}',
      '    steps:',
      '      - run: echo "$CMD"',
      '  consumer:',
      '    runs-on: ubuntu-latest',
      '    env:',
      '      CMD: echo-safe',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoHeadRefEnvShellExecution(safe, 'scoped-safe.yml')).not.toThrow();
  });

  it('enforces head-ref env propagation across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoHeadRefEnvShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
