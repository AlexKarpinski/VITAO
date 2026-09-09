import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const executionApis = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const shellExecutable = /^(?:\/bin\/)?(?:bash|sh|dash|ksh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i;
type Quote = "'" | '"' | '`' | null;

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, expression] of declarations) {
      if (tainted.has(name)) continue;
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPayloadText(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPayloadText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const collectExecutionAliases = (script: string) => {
  const modules = new Set<string>();
  const aliases = new Map<string, string>();

  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:require\(\s*['"](?:node:)?child_process['"]\s*\)|(?:await\s+)?import\(\s*['"](?:node:)?child_process['"]\s*\))/g)) {
    modules.add(match[1]);
  }

  const plainAssignments = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g)];
  let moduleChanged = true;
  while (moduleChanged) {
    moduleChanged = false;
    for (const [, alias, source] of plainAssignments) {
      if (modules.has(alias) || !modules.has(source)) continue;
      modules.add(alias);
      moduleChanged = true;
    }
  }

  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\.|\[\s*['"])(exec|execSync|execFile|execFileSync|spawn|spawnSync)(?:['"]\s*\])?/g)) {
    if (modules.has(match[2]) && executionApis.has(match[3])) aliases.set(match[1], match[3]);
  }

  let aliasChanged = true;
  while (aliasChanged) {
    aliasChanged = false;
    for (const [, alias, source] of plainAssignments) {
      if (aliases.has(alias)) continue;
      const api = aliases.get(source);
      if (!api) continue;
      aliases.set(alias, api);
      aliasChanged = true;
    }
  }

  return aliases;
};

const extractCallArgs = (script: string, name: string) => {
  const calls: string[] = [];
  const matcher = new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\s*\\(`, 'g');
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

const unquoteLiteral = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.slice(1, -1);
  return null;
};

const hasModuleAliasedUntrustedExecution = (script: string) => {
  const aliases = collectExecutionAliases(script);
  const tainted = collectTaintedIdentifiers(script);
  for (const [alias, api] of aliases) {
    for (const rawArgs of extractCallArgs(script, alias)) {
      const args = splitTopLevelArgs(rawArgs);
      const first = args[0] ?? '';
      if (api === 'exec' || api === 'execSync') {
        if (containsTaintedValue(first, tainted)) return true;
        continue;
      }
      const executable = unquoteLiteral(first);
      if (executable && shellExecutable.test(executable)) {
        const shellArgs = args[1] ?? '';
        if (/['"](?:-c|\/c|-Command)['"]/i.test(shellArgs) && containsTaintedValue(shellArgs, tainted)) return true;
      }
      if (/\bshell\s*:\s*true\b/.test(rawArgs)) {
        const commandArgs = args.slice(0, Math.max(1, args.length - 1)).join(', ');
        if (containsTaintedValue(commandArgs, tainted)) return true;
      }
    }
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
      if (trimmed && indentOf(raw) <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indentOf(raw);
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

const expectNoModuleAliasedExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasModuleAliasedUntrustedExecution(script), `${source}: child-process module alias executes attacker-controlled event text`).toBe(false);
  }
};

describe('GitHub Script child-process module alias trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoModuleAliasedExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects an execSync method copied from a require module alias', () => {
    const unsafe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const cp = require('node:child_process');",
      '            const run = cp.execSync;',
      '            run(context.payload.comment.body);',
    ].join('\n');
    expect(() => expectNoModuleAliasedExecution(unsafe, 'require-alias.yml')).toThrow();
  });

  it('rejects a method copied through a propagated module alias', () => {
    const unsafe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const cp = await import('node:child_process');",
      '            const child = cp;',
      "            const run = child['execSync'];",
      '            const command = context.payload.issue.body;',
      '            run(command);',
    ].join('\n');
    expect(() => expectNoModuleAliasedExecution(unsafe, 'propagated-module-alias.yml')).toThrow();
  });

  it('allows a copied execFileSync method when payload stays data for a non-shell executable', () => {
    const safe = [
      'jobs:', '  test:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const cp = require('node:child_process');",
      '            const run = cp.execFileSync;',
      "            run('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoModuleAliasedExecution(safe, 'safe.yml');
  });
});
