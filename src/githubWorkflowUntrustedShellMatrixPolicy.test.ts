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

const expectNoUntrustedMatrixShell = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let matrixTainted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = null;
      matrixTainted = false;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      matrixTainted = false;
      continue;
    }

    if (jobIndent === null && indent > jobsIndent && /^[A-Za-z_][A-Za-z0-9_-]*\s*:\s*$/.test(trimmed)) {
      jobIndent = indent;
      matrixTainted = false;
      continue;
    }
    if (jobIndent !== null && indent === jobIndent && /^[A-Za-z_][A-Za-z0-9_-]*\s*:\s*$/.test(trimmed)) {
      matrixTainted = false;
      continue;
    }
    if (jobIndent === null || indent <= jobIndent) continue;

    const matrix = trimmed.match(/^matrix\s*:\s*(.+)$/);
    if (matrix && isUntrustedMatrixSource(matrix[1])) {
      matrixTainted = true;
      continue;
    }

    const run = trimmed.match(/^(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (matrixTainted && run && runUsesMatrix(run[1])) {
      throw new Error(`${source}: untrusted strategy.matrix value reaches shell`);
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
