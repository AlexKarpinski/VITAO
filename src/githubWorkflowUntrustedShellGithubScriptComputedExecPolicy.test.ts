import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeComputedShellMethods = (value: string) => value.replace(
  /\[\s*(['"])(exec|execSync|execFile|execFileSync|spawn|spawnSync)\1\s*\]/g,
  '.$2',
);

const hasComputedUntrustedShellCall = (workflow: string) => {
  const normalized = normalizeComputedShellMethods(workflow);
  return /\.(?:exec|execSync)\s*\(\s*context\.payload\.(?:comment\.body|issue\.(?:title|body)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))\s*\)/.test(normalized)
    || /\.(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"](?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)['"]\s*,\s*\[[^\]]*['"]-c['"][^\]]*context\.payload\.(?:comment\.body|issue\.(?:title|body)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))[^\]]*\]/.test(normalized);
};

const expectNoComputedUntrustedShellCalls = (workflow: string, source: string) => {
  expect(
    hasComputedUntrustedShellCall(workflow),
    `${source}: computed GitHub Script shell method executes attacker-controlled payload text`,
  ).toBe(false);
};

describe('GitHub Script computed shell method trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoComputedUntrustedShellCalls(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects bracket access to execSync with comment text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            cp['execSync'](context.payload.comment.body);",
    ].join('\n');
    expect(() => expectNoComputedUntrustedShellCalls(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects bracket access to execFileSync launching Bash with comment text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            cp['execFileSync']('/bin/bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoComputedUntrustedShellCalls(unsafe, 'unsafe-shell.yml')).toThrow();
  });

  it('allows bracket access when payload is only data to a non-shell executable', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            cp['execFileSync']('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoComputedUntrustedShellCalls(safe, 'safe.yml');
  });
});
