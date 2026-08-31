import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const shellExecutable = /^(?:.*\/)?(?:bash|sh|dash|ksh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayload = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const splitTopLevelArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | null = null;
  let square = 0;
  let round = 0;
  let curly = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === ',' && square === 0 && round === 0 && curly === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const extractGetExecOutputCalls = (script: string) => {
  const calls: string[] = [];
  const matcher = /\b[A-Za-z_$][\w$]*\s*\.\s*getExecOutput\s*\(/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: "'" | '"' | '`' | null = null;
    for (let index = open + 1; index < script.length; index += 1) {
      const char = script[index];
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '(') depth += 1;
      if (char !== ')') continue;
      depth -= 1;
      if (depth !== 0) continue;
      calls.push(script.slice(open + 1, index));
      matcher.lastIndex = index + 1;
      break;
    }
  }
  return calls;
};

const unsafeGetExecOutput = (script: string) => extractGetExecOutputCalls(script).some((call) => {
  const args = splitTopLevelArgs(call);
  const executable = args[0]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  if (!shellExecutable.test(executable)) return false;
  const shellArgs = args[1] ?? '';
  return /['"](?:-c|\/c|-Command)['"]/i.test(shellArgs) && containsUntrustedPayload(shellArgs);
});

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const usesLine = lines[index].replace(/\s+#.*$/, '');
    const uses = usesLine.match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
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
      if (value && !blockHeader.test(value)) { bodies.push(value); break; }
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

const expectNoUnsafeGetExecOutput = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(unsafeGetExecOutput(script), `${source}: getExecOutput must not execute attacker-controlled text through a shell`).toBe(false);
  }
};

describe('GitHub Script getExecOutput shell boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoUnsafeGetExecOutput(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects attacker text passed to getExecOutput through bash -c', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const exec = require('@actions/exec');",
      "            await exec.getExecOutput('bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoUnsafeGetExecOutput(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows payload text passed as data to a non-shell executable', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const exec = require('@actions/exec');",
      "            await exec.getExecOutput('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoUnsafeGetExecOutput(safe, 'safe.yml');
  });
});
