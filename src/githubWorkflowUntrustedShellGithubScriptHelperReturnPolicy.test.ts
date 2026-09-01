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

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedHelpers = (script: string) => {
  const helpers = new Set<string>();
  const helperPattern = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?\breturn\s+([^;\n}]+)/g;
  for (const match of script.matchAll(helperPattern)) {
    if (containsUntrustedPayloadText(match[2])) helpers.add(match[1]);
  }
  return helpers;
};

const executesTaintedHelper = (script: string) => {
  const helpers = collectTaintedHelpers(script);
  for (const helper of helpers) {
    const escaped = helper.replace(/[$]/g, '\\$&');
    const helperCall = `${escaped}\\s*\\([^)]*\\)`;
    const directExec = new RegExp(`\\b(?:exec|execSync)\\s*(?:\\?\\.\\s*)?\\(\\s*${helperCall}`);
    const shellArg = new RegExp(`\\b(?:execFile|execFileSync|spawn|spawnSync|execa|execaSync)\\s*(?:\\?\\.\\s*)?\\([^)]*['"](?:bash|sh|dash|ksh|zsh)['"][\\s\\S]*${helperCall}`);
    if (directExec.test(script) || shellArg.test(script)) return true;
  }
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

const expectNoHelperReturnShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      executesTaintedHelper(script),
      `${source}: GitHub Script helper returns attacker-controlled event text into a shell sink`,
    ).toBe(false);
  }
};

describe('GitHub Script helper-return taint policy', () => {
  it('rejects attacker text returned by a helper and executed with execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            function getCommand() { return context.payload.comment.body; }',
      "            const cp = require('node:child_process');",
      '            cp.execSync(getCommand());',
    ].join('\n');
    expect(() => expectNoHelperReturnShellExecution(unsafe, 'helper-return.yml')).toThrow();
  });

  it('allows a helper that returns repository-owned constant text', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            function getCommand() { return 'printf safe'; }",
      "            const cp = require('node:child_process');",
      '            cp.execSync(getCommand());',
    ].join('\n');
    expectNoHelperReturnShellExecution(safe, 'helper-return-safe.yml');
  });

  it('enforces helper-return taint across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoHelperReturnShellExecution(readFileSync(join(workflowsDir, name), 'utf8'), name);
    }
  });
});
