import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const stripYamlComment = (value: string) => {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') { index += 1; continue; }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
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
  const assignments = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  const tainted = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, value] of assignments) {
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

const collectVmCompilationAliases = (script: string) => {
  const aliases = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"](?:node:)?vm['"]\s*\)/g)) {
    for (const member of match[1].split(',')) {
      const binding = member.trim().match(/^(runInThisContext|runInNewContext|runInContext|compileFunction)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (binding) aliases.add(binding[2] ?? binding[1]);
    }
  }
  return aliases;
};

const hasTaintedDestructuredVmExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const argumentIsTainted = (argument: string) => containsUntrustedPayloadText(argument)
    || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(argument));

  for (const alias of collectVmCompilationAliases(script)) {
    const escaped = alias.replace(/[$]/g, '\\$&');
    for (const match of script.matchAll(new RegExp(`\\b${escaped}\\s*\\(([^)]*)\\)`, 'g'))) {
      const args = match[1]
        .split(',')
        .map((argument) => argument.trim())
        .filter(Boolean);
      if (args.some(argumentIsTainted)) return true;
    }
  }
  return false;
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
      if (value && !blockHeader.test(value)) { bodies.push(value); break; }
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

const expectNoTaintedDestructuredVmExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasTaintedDestructuredVmExecution(script),
      `${source}: GitHub Script executes attacker-controlled code through a destructured node:vm alias`,
    ).toBe(false);
  }
};

describe('GitHub Script destructured node:vm alias policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoTaintedDestructuredVmExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects compileFunction destructured from node:vm with attacker-controlled code', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { compileFunction } = require('node:vm');",
      '            compileFunction(context.payload.comment.body)();',
    ].join('\n');
    expect(() => expectNoTaintedDestructuredVmExecution(unsafe, 'vm-destructured.yml')).toThrow();
  });

  it('rejects renamed destructured VM compilation aliases through a local tainted alias', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { compileFunction: compile } = require('vm');",
      '            const code = context.payload.issue.body;',
      '            compile(code)();',
    ].join('\n');
    expect(() => expectNoTaintedDestructuredVmExecution(unsafe, 'vm-destructured-alias.yml')).toThrow();
  });

  it('allows destructured VM compilation aliases with repository-owned constant code', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { compileFunction: compile } = require('node:vm');",
      "            const result = compile('return 3')();",
      '            core.info(String(result));',
    ].join('\n');
    expectNoTaintedDestructuredVmExecution(safe, 'vm-destructured-safe.yml');
  });
});