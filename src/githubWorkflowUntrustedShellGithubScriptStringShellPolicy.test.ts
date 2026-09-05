import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

type Quote = "'" | '"' | '`' | null;

const stripYamlComment = (value: string) => {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
};

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedIdentifiers = (script: string) => {
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  const tainted = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, value] of declarations) {
      if (tainted.has(name)) continue;
      const derived = containsUntrustedPayloadText(value)
        || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));
      if (!derived) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPayloadText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const splitTopLevelArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: Quote = null;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
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
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const collectSpawnArgs = (script: string) => {
  const calls: string[] = [];
  const matcher = /\bspawn(?:Sync)?\s*\(/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: Quote = null;
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

const hasNonEmptyStringShell = (options: string) =>
  /\bshell\s*:\s*(?:'[^']+'|"[^"]+"|`[^`]+`)/.test(options);

const hasUntrustedStringShellExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  return collectSpawnArgs(script).some((callArgs) => {
    const args = splitTopLevelArgs(callArgs);
    const command = args[0] ?? '';
    const options = args.at(-1) ?? '';
    return hasNonEmptyStringShell(options) && containsTaintedValue(command, tainted);
  });
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const usesLine = stripYamlComment(lines[index]);
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
      const value = stripYamlComment(script[1]).trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        if (bodyRaw.trim() && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyRaw.trim()) body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoUntrustedStringShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasUntrustedStringShellExecution(script),
      `${source}: GitHub Script executes attacker-controlled text through a string-valued shell option`,
    ).toBe(false);
  }
};

describe('GitHub Script string-valued shell option policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedStringShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled commands with a string-valued shell option', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync(context.payload.comment.body, [], { shell: '/bin/bash' });",
    ].join('\n');
    expect(() => expectNoUntrustedStringShellExecution(unsafe, 'string-shell.yml')).toThrow();
  });

  it('rejects tainted command aliases with a string-valued shell option', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const command = context.payload.issue.body;',
      "            require('node:child_process').spawn(command, [], { shell: 'bash' });",
    ].join('\n');
    expect(() => expectNoUntrustedStringShellExecution(unsafe, 'string-shell-alias.yml')).toThrow();
  });

  it('allows payload text passed as data when no shell option is enabled', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoUntrustedStringShellExecution(safe, 'string-shell-safe.yml');
  });
});
