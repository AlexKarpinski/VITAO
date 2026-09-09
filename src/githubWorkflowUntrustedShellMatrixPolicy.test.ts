import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const isUntrustedMatrixSource = (value: string) => {
  const normalized = normalizeAccess(value);
  return /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /tojson\(\s*github\.event(?:\.|\s*\))/i.test(normalized);
};

const runUsesMatrix = (value: string) => /\$\{\{[\s\S]*\bmatrix\.[A-Za-z_][A-Za-z0-9_-]*\b[\s\S]*\}\}/.test(normalizeAccess(value));
const isExecutionSink = (value: string) => /(?:\b(?:bash|sh|dash|ksh|zsh)\s+-c\b|\beval\b|\bInvoke-Expression\b|\bcall\b)/i.test(value);
const referencesEnvironment = (value: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp('\\$' + escaped + '\\b'),
    new RegExp('\\$\\{' + escaped + '(?::[^}]*)?\\}'),
    new RegExp('\\$env:' + escaped + '\\b', 'i'),
    new RegExp('\\$\\{env:' + escaped + '\\}', 'i'),
    new RegExp('%' + escaped + '%', 'i'),
    new RegExp('\\$\\{\\{\\s*env\\.' + escaped + '\\s*\\}\\}', 'i'),
  ].some((pattern) => pattern.test(value));
};
const isBlockHeader = (value: string) => /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)$/.test(value.trim());
const isJobKey = (value: string) => /^(?:[A-Za-z_][A-Za-z0-9_-]*|"[A-Za-z_][A-Za-z0-9_-]*"|'[A-Za-z_][A-Za-z0-9_-]*')\s*:\s*$/.test(value);

const collectIndentedValue = (lines: string[], start: number, parentIndent: number) => {
  const parts: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (trimmed && indent <= parentIndent) break;
    if (trimmed) parts.push(trimmed);
    end = index;
  }
  return { value: parts.join(' '), end };
};

const expectNoUntrustedMatrixShell = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let matrixIndent: number | null = null;
  let envIndent: number | null = null;
  let matrixTainted = false;
  let matrixTaintedEnv = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = null;
      matrixIndent = null;
      envIndent = null;
      matrixTainted = false;
      matrixTaintedEnv = new Set<string>();
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      matrixIndent = null;
      envIndent = null;
      matrixTainted = false;
      matrixTaintedEnv = new Set<string>();
      continue;
    }

    if (jobIndent === null && indent > jobsIndent && isJobKey(trimmed)) {
      jobIndent = indent;
      matrixIndent = null;
      envIndent = null;
      matrixTainted = false;
      matrixTaintedEnv = new Set<string>();
      continue;
    }
    if (jobIndent !== null && indent === jobIndent && isJobKey(trimmed)) {
      matrixIndent = null;
      envIndent = null;
      matrixTainted = false;
      matrixTaintedEnv = new Set<string>();
      continue;
    }
    if (jobIndent === null || indent <= jobIndent) continue;

    const matrix = trimmed.match(/^matrix\s*:\s*(.*)$/);
    if (matrix) {
      matrixIndent = indent;
      if (matrix[1] && isUntrustedMatrixSource(matrix[1])) matrixTainted = true;
      continue;
    }

    if (matrixIndent !== null) {
      if (indent <= matrixIndent) {
        matrixIndent = null;
      } else if (isUntrustedMatrixSource(trimmed)) {
        matrixTainted = true;
      }
    }

    if (envIndent !== null && indent <= envIndent) envIndent = null;

    const env = trimmed.match(/^(?:-\s*)?env\s*:\s*(.*)$/);
    if (env) {
      const effectiveIndent = indent + (/^-\s+env\b/.test(trimmed) ? 2 : 0);
      const inline = env[1].trim();
      if (!inline) {
        envIndent = effectiveIndent;
      } else if (matrixTainted && inline.startsWith('{') && inline.endsWith('}')) {
        for (const entry of inline.slice(1, -1).split(',')) {
          const match = entry.trim().match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*)$/);
          if (match && runUsesMatrix(match[2])) matrixTaintedEnv.add(match[1]);
        }
      }
    } else if (envIndent !== null && indent > envIndent) {
      const entry = trimmed.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.*)$/);
      if (entry && matrixTainted) {
        let envValue = entry[2];
        if (isBlockHeader(envValue)) {
          const collected = collectIndentedValue(lines, index, indent);
          envValue = collected.value;
          index = collected.end;
        }
        if (runUsesMatrix(envValue)) matrixTaintedEnv.add(entry[1]);
      }
    }

    const run = trimmed.match(/^(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (matrixTainted && run) {
      let runValue = run[1];
      if (isBlockHeader(runValue)) {
        const collected = collectIndentedValue(lines, index, indent);
        runValue = collected.value;
        index = collected.end;
      }
      if (runUsesMatrix(runValue)) {
        throw new Error(`${source}: untrusted strategy.matrix value reaches shell`);
      }
      if (isExecutionSink(runValue) && [...matrixTaintedEnv].some((name) => referencesEnvironment(runValue, name))) {
        throw new Error(`${source}: untrusted strategy.matrix value reaches shell through env`);
      }
    }
  }
};

describe('GitHub workflow matrix-to-shell trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedMatrixShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects issue-controlled matrix values used as shell commands', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ matrix.command }}'",
    ].join('\n');
    expect(() => expectNoUntrustedMatrixShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects issue-controlled matrix values in quoted job IDs', () => {
    const unsafe = [
      'jobs:',
      '  "build":',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ matrix.command }}'",
    ].join('\n');
    expect(() => expectNoUntrustedMatrixShell(unsafe, 'quoted-job.yml')).toThrow();
  });

  it('rejects untrusted values nested below a matrix mapping', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        command: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ matrix.command }}'",
    ].join('\n');
    expect(() => expectNoUntrustedMatrixShell(unsafe, 'nested-matrix.yml')).toThrow();
  });

  it('rejects matrix references inside block-scalar run bodies', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      "          bash -c '${{ matrix.command }}'",
    ].join('\n');
    expect(() => expectNoUntrustedMatrixShell(unsafe, 'block-run.yml')).toThrow();
  });

  it('rejects tainted matrix values routed through step env into shell execution', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - env:',
      '          CMD: ${{ matrix.command }}',
      '        run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoUntrustedMatrixShell(unsafe, 'matrix-env-shell.yml')).toThrow();
  });

  it('allows tainted matrix values consumed only as quoted data', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - env:',
      '          BODY: ${{ matrix.command }}',
      "        run: printf '%s\\n' \"$BODY\"",
    ].join('\n');
    expectNoUntrustedMatrixShell(safe, 'matrix-env-data.yml');
  });

  it('allows a constant matrix used by a shell step', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix: { command: [echo-safe] }',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ matrix.command }}'",
    ].join('\n');
    expectNoUntrustedMatrixShell(safe, 'safe.yml');
  });

  it('does not leak taint between sibling jobs', () => {
    const safe = [
      'jobs:',
      '  metadata:',
      '    strategy:',
      '      matrix: ${{ fromJSON(github.event.issue.body) }}',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: console.log(context.payload)',
      '  execute:',
      '    strategy:',
      '      matrix: { command: [echo-safe] }',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ matrix.command }}'",
    ].join('\n');
    expectNoUntrustedMatrixShell(safe, 'sibling-jobs.yml');
  });
});
