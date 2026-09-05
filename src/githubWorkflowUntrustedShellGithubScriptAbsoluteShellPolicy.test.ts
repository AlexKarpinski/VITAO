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
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|discussion\.(?:title|body))/.test(normalized);
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return null;
};

const isShellExecutable = (value: string) => {
  const literal = unquote(value);
  if (!literal) return false;
  const basename = literal.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '';
  return /^(?:bash|sh|dash|ksh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(basename);
};

const splitTopLevelArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: "'" | '"' | '`' | null = null;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
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
    if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === ',' && parens === 0 && brackets === 0 && braces === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const extractCalls = (script: string) => {
  const calls: string[] = [];
  const matcher = /\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: "'" | '"' | '`' | null = null;
    for (let index = open + 1; index < script.length; index += 1) {
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

const containsAbsoluteShellExecution = (script: string) => extractCalls(script).some((call) => {
  const args = splitTopLevelArgs(call);
  if (!isShellExecutable(args[0] ?? '')) return false;
  const shellArgs = args[1] ?? '';
  return /['"](?:-c|\/c|-Command)['"]/i.test(shellArgs) && containsUntrustedPayloadText(shellArgs);
});

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
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        if (bodyRaw.trim() && indentOf(bodyRaw) <= indent) break;
        if (bodyRaw.trim()) body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoAbsoluteShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(containsAbsoluteShellExecution(script), `${source}: absolute shell path executes attacker-controlled payload text`).toBe(false);
  }
};

describe('GitHub Script absolute shell executable boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoAbsoluteShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects spawnSync through /usr/bin/bash', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('/usr/bin/bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoAbsoluteShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects another absolute Bash installation path by basename', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execFileSync('/opt/homebrew/bin/bash', ['-c', context.payload.issue.body]);",
    ].join('\n');
    expect(() => expectNoAbsoluteShellExecution(unsafe, 'alternate-bash.yml')).toThrow();
  });

  it('allows a non-shell executable to receive payload text as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoAbsoluteShellExecution(safe, 'safe.yml');
  });
});
