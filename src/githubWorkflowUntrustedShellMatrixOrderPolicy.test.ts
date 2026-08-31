import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const untrustedMatrix = /\bmatrix\b[\s\S]*?(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|discussion\.(?:title|body))/;
const matrixRef = /\$\{\{[\s\S]*?\bmatrix\.([A-Za-z_][A-Za-z0-9_-]*)[\s\S]*?\}\}/;
const executionSink = /(?:\b(?:bash|sh|dash|ksh|zsh)\s+-c\b|\beval\b|\bInvoke-Expression\b|\bcall\b)/i;

const referencesEnv = (value: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp('\\$' + escaped + '\\b'),
    new RegExp('\\$\\{' + escaped + '(?::[^}]*)?\\}'),
    new RegExp('\\$env:' + escaped + '\\b', 'i'),
    new RegExp('%' + escaped + '%', 'i'),
    new RegExp('\\$\\{\\{\\s*env\\.' + escaped + '\\s*\\}\\}', 'i'),
  ].some((pattern) => pattern.test(value));
};

const jobBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const blocks: string[][] = [];
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let current: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = indentOf(line);
    if (!trimmed || trimmed.startsWith('#')) {
      if (current) current.push(line);
      continue;
    }
    if (jobsIndent === null) {
      if (/^jobs\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (indent <= jobsIndent) {
      if (current) blocks.push(current);
      current = null;
      jobsIndent = null;
      jobIndent = null;
      continue;
    }
    if (jobIndent === null && /^["']?[A-Za-z_][A-Za-z0-9_-]*["']?\s*:\s*$/.test(trimmed)) {
      jobIndent = indent;
      current = [line];
      continue;
    }
    if (jobIndent !== null && indent === jobIndent && /^["']?[A-Za-z_][A-Za-z0-9_-]*["']?\s*:\s*$/.test(trimmed)) {
      if (current) blocks.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
};

const matrixEnvNames = (block: string[]) => {
  const names = new Set<string>();
  let envIndent: number | null = null;
  for (const line of block) {
    const trimmed = line.trim();
    const indent = indentOf(line);
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (envIndent !== null && indent <= envIndent) envIndent = null;

    const env = trimmed.match(/^(?:-\s*)?env\s*:\s*(.*)$/);
    if (env) {
      const inline = env[1].trim();
      if (!inline) {
        envIndent = indent + (/^-\s+env\b/.test(trimmed) ? 2 : 0);
      } else if (inline.startsWith('{') && inline.endsWith('}')) {
        for (const entry of inline.slice(1, -1).split(',')) {
          const match = entry.trim().match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*)$/);
          if (match && matrixRef.test(match[2])) names.add(match[1]);
        }
      }
      continue;
    }
    if (envIndent !== null && indent > envIndent) {
      const entry = trimmed.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*)$/);
      if (entry && matrixRef.test(entry[2])) names.add(entry[1]);
    }
  }
  return names;
};

const assertMatrixOrderSafe = (workflow: string, source: string) => {
  for (const block of jobBlocks(workflow)) {
    const text = block.join('\n');
    if (!untrustedMatrix.test(text)) continue;
    const taintedEnv = matrixEnvNames(block);
    if (taintedEnv.size === 0) continue;
    for (const line of block) {
      const run = line.trim().match(/^(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
      if (!run || !executionSink.test(run[1])) continue;
      if ([...taintedEnv].some((name) => referencesEnv(run[1], name))) {
        throw new Error(`${source}: untrusted matrix env reaches shell regardless of YAML key order`);
      }
    }
  }
};

describe('GitHub workflow matrix taint is independent of job key order', () => {
  it('rejects matrix-derived env declared before the tainted strategy matrix', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    env: { CMD: ${{ matrix.command }} }',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertMatrixOrderSafe(unsafe, 'unsafe.yml')).toThrow(/regardless of YAML key order/);
  });

  it('allows the same ordering when the matrix is repository-controlled', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    env: { CMD: ${{ matrix.command }} }',
      '    strategy:',
      '      matrix: { command: [echo-safe] }',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertMatrixOrderSafe(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces the ordering-independent boundary across checked-in workflows', () => {
    for (const file of workflowFiles) {
      assertMatrixOrderSafe(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
