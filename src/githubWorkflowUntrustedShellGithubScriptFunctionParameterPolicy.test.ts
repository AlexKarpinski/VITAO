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

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].replace(/\s+#.*$/, '').match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
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

type FunctionInfo = { name: string; params: string[]; body: string };

const collectFunctions = (script: string): FunctionInfo[] => {
  const functions: FunctionInfo[] = [];
  const matcher = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const bodyStart = matcher.lastIndex;
    let depth = 1;
    let quote: "'" | '"' | '`' | null = null;
    let bodyEnd = script.length;
    for (let index = bodyStart; index < script.length; index += 1) {
      const char = script[index];
      if (quote) {
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
    functions.push({
      name: match[1],
      params: match[2].split(',').map((param) => param.trim()).filter(Boolean),
      body: script.slice(bodyStart, bodyEnd),
    });
    matcher.lastIndex = bodyEnd + 1;
  }
  return functions;
};

const splitArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const calledWithUntrustedParam = (script: string, fn: FunctionInfo) => {
  const call = new RegExp(`\\b${fn.name}\\s*\\(([^;\\n]*)\\)`, 'g');
  const tainted = new Set<string>();
  for (let match = call.exec(script); match; match = call.exec(script)) {
    const args = splitArgs(match[1]);
    args.forEach((arg, index) => {
      if (fn.params[index] && containsUntrustedPayloadText(arg)) tainted.add(fn.params[index]);
    });
  }
  return tainted;
};

const functionExecutesTaintedParam = (fn: FunctionInfo, tainted: Set<string>) => {
  for (const param of tainted) {
    const escaped = param.replace(/[$]/g, '\\$&');
    const implicitShell = new RegExp(`(?:\\.|\\b)(?:exec|execSync)\\s*\\(\\s*${escaped}\\b`);
    const explicitShell = new RegExp(`(?:\\.|\\b)(?:execFile|execFileSync|spawn|spawnSync)\\s*\\(\\s*['\"](?:[^'\"]*\\/)?(?:bash|sh|dash|ksh|zsh|cmd(?:\\.exe)?|powershell(?:\\.exe)?|pwsh(?:\\.exe)?)['\"]\\s*,[\\s\\S]*?['\"](?:-c|\\/c|-Command)['\"][\\s\\S]*?\\b${escaped}\\b`, 'i');
    if (implicitShell.test(fn.body) || explicitShell.test(fn.body)) return true;
  }
  return false;
};

const hasUntrustedFunctionParameterExecution = (script: string) =>
  collectFunctions(script).some((fn) => functionExecutesTaintedParam(fn, calledWithUntrustedParam(script, fn)));

const expectNoFunctionParameterShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasUntrustedFunctionParameterExecution(script),
      `${source}: GitHub Script passes attacker-controlled event text through a local function into shell execution`,
    ).toBe(false);
  }
};

describe('GitHub Script local-function shell trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoFunctionParameterShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects payload text passed through a local function parameter to execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      '            function run(command) { cp.execSync(command); }',
      '            run(context.payload.comment.body);',
    ].join('\n');
    expect(() => expectNoFunctionParameterShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects payload text passed through a local function into an explicit Bash launch', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            function run(command) { cp.spawnSync('/usr/bin/bash', ['-c', command]); }",
      '            run(context.payload.issue.body);',
    ].join('\n');
    expect(() => expectNoFunctionParameterShellExecution(unsafe, 'unsafe-shell.yml')).toThrow();
  });

  it('allows untrusted text passed to a helper that treats it only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            function print(value) { cp.execFileSync('/usr/bin/printf', ['%s', value]); }",
      '            print(context.payload.comment.body);',
    ].join('\n');
    expectNoFunctionParameterShellExecution(safe, 'safe.yml');
  });
});
