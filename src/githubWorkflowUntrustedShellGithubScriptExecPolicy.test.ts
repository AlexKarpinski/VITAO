import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (script: string) => {
  const normalized = normalizePayloadAccess(script);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const shellExecutable = String.raw`(?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)|(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)`;

const hasShellExecutionSink = (script: string) => {
  if (/\b(?:exec|execSync)\s*\(/.test(script)) return true;
  const explicitShell = new RegExp(
    String.raw`\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"](?:${shellExecutable})['"]\s*,\s*\[[\s\S]*?['"](?:-c|\/c|-Command)['"]`,
    'i',
  );
  if (explicitShell.test(script)) return true;
  if (/\b(?:spawn|spawnSync)\s*\([\s\S]*?\{[\s\S]*?\bshell\s*:\s*true\b[\s\S]*?\}/.test(script)) return true;
  if (/\b(?:execa|execaSync)\s*\([\s\S]*?\{[\s\S]*?\bshell\s*:\s*true\b[\s\S]*?\}/.test(script)) return true;
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoUntrustedGithubScriptShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      containsUntrustedPayloadText(script) && hasShellExecutionSink(script),
      `${source}: GitHub Script executes attacker-controlled event text through a shell API`,
    ).toBe(false);
  }
};

describe('GitHub Script shell execution trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedGithubScriptShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct child-process execution of comment text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.comment.body);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects spawn with shell true when its script reads attacker text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const command = context.payload.issue.body;',
      "            require('node:child_process').spawn(command, [], { shell: true });",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'spawn.yml')).toThrow();
  });

  it('rejects execFileSync when it explicitly launches Bash with attacker text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execFileSync('/bin/bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'exec-file.yml')).toThrow();
  });

  it('rejects spawnSync of an explicit shell even without shell true', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('bash', ['-c', context.payload.issue.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'spawn-shell.yml')).toThrow();
  });

  it('allows execFileSync of a non-shell executable with payload as an argument', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execFileSync('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'exec-file-safe.yml');
  });

  it('allows payload text used only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'safe.yml');
  });
});
