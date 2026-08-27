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
const isBlockHeader = (value: string) => /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)$/.test(value.trim());

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
  let matrixTainted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = null;
      matrixIndent = null;
      matrixTainted = false;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      matrixIndent = null;
      matrixTainted = false;
      continue;
    }

    if (jobIndent === null && indent > jobsIndent && /^[A-Za-z_][A-Za-z0-9_-]*\s*:\s*$/.test(trimmed)) {
      jobIndent = indent;
      matrixIndent = null;
      matrixTainted = false;
      continue;
    }
    if (jobIndent !== null && indent === jobIndent && /^[A-Za-z_][A-Za-z0-9_-]*\s*:\s*$/.test(trimmed)) {
      matrixIndent = null;
      matrixTainted = false;
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
