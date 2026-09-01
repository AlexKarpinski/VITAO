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

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const [, name, expression] = declaration;
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

const hasIndirectChildProcessExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const callPattern = /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?(?:exec|execSync)\s*\.\s*call\s*\(\s*[^,]+\s*,\s*([^)]+)\)/g;
  for (const match of script.matchAll(callPattern)) {
    if (containsTaintedValue(match[1], tainted)) return true;
  }

  const applyPattern = /(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?(?:exec|execSync)\s*\.\s*apply\s*\(\s*[^,]+\s*,\s*\[([\s\S]*?)\]\s*\)/g;
  for (const match of script.matchAll(applyPattern)) {
    if (containsTaintedValue(match[1], tainted)) return true;
  }

  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*(?:#.*)?$/);
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

const assertNoIndirectChildProcessExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasIndirectChildProcessExecution(script),
      `${source}: GitHub Script indirectly invokes a shell sink with attacker-controlled text`,
    ).toBe(false);
  }
};

describe('GitHub Script indirect child-process invocation policy', () => {
  it('rejects execSync.call with attacker-controlled text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      '            cp.execSync.call(null, context.payload.comment.body);',
    ].join('\n');
    expect(() => assertNoIndirectChildProcessExecution(unsafe, 'call.yml')).toThrow();
  });

  it('rejects exec.apply with a tainted local alias', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      '            const command = context.payload.issue.body;',
      '            cp.exec.apply(null, [command]);',
    ].join('\n');
    expect(() => assertNoIndirectChildProcessExecution(unsafe, 'apply.yml')).toThrow();
  });

  it('allows indirect invocation with repository-owned constant text', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      "            cp.execSync.call(null, 'printf safe');",
    ].join('\n');
    assertNoIndirectChildProcessExecution(safe, 'safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertNoIndirectChildProcessExecution(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
