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

const splitTopLevel = (value: string, delimiter = ',') => {
  const parts: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === delimiter && braces === 0 && brackets === 0 && parens === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const findTopLevelColon = (value: string) => {
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === ':' && braces === 0 && brackets === 0 && parens === 0) return index;
  }
  return -1;
};

const collectDestructuredTaint = (script: string) => {
  const tainted = new Set<string>();

  const visitPattern = (pattern: string, source: string) => {
    for (const rawField of splitTopLevel(pattern)) {
      const field = rawField.replace(/\s*=.*$/s, '').trim();
      const colon = findTopLevelColon(field);
      const property = (colon >= 0 ? field.slice(0, colon) : field).trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(property)) continue;
      const remainder = colon >= 0 ? field.slice(colon + 1).trim() : '';
      const nested = remainder.match(/^\{([\s\S]*)\}$/);
      if (nested) {
        visitPattern(nested[1], `${source}.${property}`);
        continue;
      }
      const local = remainder || property;
      if (!/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      if (containsUntrustedPayloadText(`${source}.${property}`)) tainted.add(local);
    }
  };

  const declarationStart = /\b(?:const|let|var)\s*\{/g;
  for (const match of script.matchAll(declarationStart)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf('{');
    let depth = 0;
    let close = -1;
    for (let index = open; index < script.length; index += 1) {
      if (script[index] === '{') depth += 1;
      else if (script[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = index;
          break;
        }
      }
    }
    if (close < 0) continue;
    const assignment = script.slice(close + 1).match(/^\s*=\s*([^;\n]+)/);
    if (!assignment) continue;
    visitPattern(script.slice(open + 1, close), assignment[1].trim());
  }
  return tainted;
};

const hasDestructuredPayloadShellExecution = (script: string) => {
  const tainted = collectDestructuredTaint(script);
  if (tainted.size === 0) return false;
  for (const match of script.matchAll(/\b(?:exec|execSync)\s*\(([^)]+)\)/g)) {
    const command = match[1].split(',')[0] ?? '';
    if ([...tainted].some((name) => new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`).test(command))) return true;
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

const expectNoDestructuredPayloadShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasDestructuredPayloadShellExecution(script),
      `${source}: destructured attacker-controlled GitHub text reaches a shell execution API`,
    ).toBe(false);
  }
};

describe('GitHub Script destructured payload shell boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoDestructuredPayloadShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects destructured comment text passed to execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { body } = context.payload.comment;',
      "            require('node:child_process').execSync(body);",
    ].join('\n');
    expect(() => expectNoDestructuredPayloadShellExecution(unsafe, 'destructured.yml')).toThrow();
  });

  it('rejects aliased destructured comment text passed to exec', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { body: command } = context.payload.comment;',
      "            require('node:child_process').exec(command);",
    ].join('\n');
    expect(() => expectNoDestructuredPayloadShellExecution(unsafe, 'aliased-destructured.yml')).toThrow();
  });

  it('rejects nested destructured comment text passed to execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { payload: { comment: { body } } } = context;',
      "            require('node:child_process').execSync(body);",
    ].join('\n');
    expect(() => expectNoDestructuredPayloadShellExecution(unsafe, 'nested-destructured.yml')).toThrow();
  });

  it('allows destructured non-text metadata beside a constant command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { id } = context.payload.comment;',
      '            core.info(String(id));',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');
    expectNoDestructuredPayloadShellExecution(safe, 'safe-destructured.yml');
  });
});
