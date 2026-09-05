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

type Call = { name: string; args: string };

const normalizeMemberAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_$][\w$-]*)['"]\s*\]/g, '.$1');

const untrustedObject = /context\.payload\.(?:issue|comment|pull_request|review|review_comment|discussion)\b/;
const untrustedLeaf = /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))\b/;

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
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
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

const extractCalls = (script: string): Call[] => {
  const calls: Call[] = [];
  const matcher = /\b(execFileSync|spawnSync)\s*\(/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: Quote = null;
    for (let index = open + 1; index < script.length; index += 1) {
      const char = script[index];
      if (quote) {
        if (char === '\\') { index += 1; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
      if (char === '(') depth += 1;
      if (char !== ')') continue;
      depth -= 1;
      if (depth !== 0) continue;
      calls.push({ name: match[1], args: script.slice(open + 1, index) });
      matcher.lastIndex = index + 1;
      break;
    }
  }
  return calls;
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return null;
};

const collectTaint = (script: string) => {
  const normalized = normalizeMemberAccess(script);
  const objects = new Set<string>();
  const values = new Set<string>();
  const declarations = [...normalized.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, expression] of declarations) {
      if (!objects.has(name) && (untrustedObject.test(expression) || [...objects].some((object) => new RegExp(`\\b${object}\\b`).test(expression)))) {
        objects.add(name);
        changed = true;
      }
      if (values.has(name)) continue;
      const fromObjectLeaf = [...objects].some((object) => new RegExp(`\\b${object}\\.(?:title|body|diff_hunk|path|ref|label)\\b`).test(expression));
      const fromValue = [...values].some((value) => new RegExp(`\\b${value}\\b`).test(expression));
      if (untrustedLeaf.test(expression) || fromObjectLeaf || fromValue) {
        values.add(name);
        changed = true;
      }
    }
  }
  return { objects, values };
};

const containsTaintedValue = (raw: string, taint: ReturnType<typeof collectTaint>) => {
  const value = normalizeMemberAccess(raw);
  if (untrustedLeaf.test(value)) return true;
  if ([...taint.objects].some((object) => new RegExp(`\\b${object}\\.(?:title|body|diff_hunk|path|ref|label)\\b`).test(value))) return true;
  return [...taint.values].some((identifier) => new RegExp(`\\b${identifier}\\b`).test(value));
};

const hasTaintedShellStdin = (script: string) => {
  const taint = collectTaint(script);
  for (const call of extractCalls(script)) {
    const args = splitTopLevelArgs(call.args);
    const executable = unquote(args[0] ?? '')?.split('/').pop()?.toLowerCase();
    if (!executable || !['bash', 'sh', 'dash', 'ksh', 'zsh'].includes(executable)) continue;
    const argv = args[1] ?? '';
    if (!/['"]-s['"]/.test(argv)) continue;
    const options = args[2] ?? '';
    const input = options.match(/\binput\s*:\s*([^,}]+)/)?.[1];
    if (input && containsTaintedValue(input, taint)) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*(?:#.*)?$/i);
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

const expectNoTaintedShellStdin = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasTaintedShellStdin(script), `${source}: attacker-controlled text is supplied as shell stdin`).toBe(false);
  }
};

describe('GitHub Script shell stdin trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoTaintedShellStdin(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects aliased comment text supplied to bash stdin', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const comment = context.payload.comment;',
      "            require('node:child_process').execFileSync('bash', ['-s'], { input: comment.body });",
    ].join('\n');
    expect(() => expectNoTaintedShellStdin(unsafe, 'stdin-unsafe.yml')).toThrow();
  });

  it('allows repository-owned shell stdin even when payload text is logged', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const comment = context.payload.comment;',
      '            core.info(comment.body);',
      "            require('node:child_process').execFileSync('bash', ['-s'], { input: 'echo safe' });",
    ].join('\n');
    expectNoTaintedShellStdin(safe, 'stdin-safe.yml');
  });
});
