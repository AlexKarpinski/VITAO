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

const hasTaintedCodeExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const argumentIsTainted = (argument: string) => containsUntrustedPayloadText(argument)
    || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(argument));

  for (const match of script.matchAll(/(?:^|[^\w$])(?:(?:globalThis|global|window|self)\s*(?:\.\s*eval|\[\s*['"]eval['"]\s*\])|eval)\s*\(([^)]+)\)/g)) {
    if (argumentIsTainted(match[1])) return true;
  }

  for (const match of script.matchAll(/(?:^|[^\w$.])(Function|AsyncFunction)\s*\(([^)]*)\)/g)) {
    const args = match[2]
      .split(',')
      .map((argument) => argument.trim())
      .filter(Boolean);
    if (args.some(argumentIsTainted)) return true;
  }

  for (const match of script.matchAll(/(?:require\(\s*['"](?:node:)?vm['"]\s*\)|\bvm)\.(?:runInThisContext|runInNewContext|runInContext|compileFunction)\s*\(([^)]*)\)/g)) {
    const args = match[1]
      .split(',')
      .map((argument) => argument.trim())
      .filter(Boolean);
    if (args.some(argumentIsTainted)) return true;
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

const expectNoTaintedCodeExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasTaintedCodeExecution(script), `${source}: GitHub Script evaluates attacker-controlled code`).toBe(false);
  }
};

describe('GitHub Script executable-code policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoTaintedCodeExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects direct eval of attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            eval(context.payload.comment.body);'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'eval.yml')).toThrow();
  });

  it('rejects member-invoked eval of attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            globalThis.eval(context.payload.comment.body);'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'member-eval.yml')).toThrow();
  });

  it('rejects computed member eval of attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', "            globalThis['eval'](context.payload.comment.body);"].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'computed-eval.yml')).toThrow();
  });

  it('rejects eval through a local tainted alias', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            const code = context.payload.issue.body;', '            eval(code);'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'eval-alias.yml')).toThrow();
  });

  it('rejects Function constructors of attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            Function(context.payload.comment.body)();'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'function.yml')).toThrow();
  });

  it('rejects Function constructors through a local tainted alias', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            const code = context.payload.issue.body;', '            Function(code)();'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'function-alias.yml')).toThrow();
  });

  it('rejects Node VM execution of attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', "            require('node:vm').runInThisContext(context.payload.comment.body);"].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'vm.yml')).toThrow();
  });

  it('rejects Node VM execution through a local tainted alias', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            const code = context.payload.issue.body;', '            vm.runInNewContext(code, {});'].join('\n');
    expect(() => expectNoTaintedCodeExecution(unsafe, 'vm-alias.yml')).toThrow();
  });

  it('allows code execution constructors with constant code', () => {
    const safe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', "            const result = eval('1 + 1');", "            const memberResult = globalThis.eval('2 + 2');", "            const fn = Function('return 2');", "            const vmResult = require('node:vm').runInThisContext('1 + 2');", '            core.info(String(result + memberResult + fn() + vmResult));'].join('\n');
    expectNoTaintedCodeExecution(safe, 'eval-safe.yml');
  });
});
