import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedText = (value: string) => {
  const normalized = normalizeAccess(value);
  return /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body)/.test(normalized)
    || /tojson\s*\(\s*github\.event(?:\.[A-Za-z_][A-Za-z0-9_-]*)?\s*\)/i.test(normalized);
};

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const shellReferencesEnv = (shell: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\$\\{\\{\\s*env(?:\\.${escaped}|\\[['\"]${escaped}['\"]\\])\\s*\\}\\}|\\$\\{${escaped}\\}|\\$${escaped}(?![A-Za-z0-9_])`).test(shell);
};

type Step = { lines: string[]; indent: number };

const collectBlockSteps = (workflow: string) => {
  const lines = workflow.split('\n');
  const steps: Step[] = [];
  let stepsIndent: number | null = null;
  let current: Step | null = null;

  const flush = () => { if (current) steps.push(current); current = null; };

  for (const raw of lines) {
    const line = stripYamlComment(raw);
    const trimmed = line.trim();
    const indent = indentOf(raw);
    if (!trimmed) { if (current) current.lines.push(raw); continue; }

    if (stepsIndent === null) {
      if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) stepsIndent = indent;
      continue;
    }

    if (indent <= stepsIndent) {
      flush();
      stepsIndent = /^["']?steps["']?\s*:\s*$/.test(trimmed) ? indent : null;
      continue;
    }

    const marker = line.match(/^(\s*)-\s*(.*)$/);
    if (marker && indent > stepsIndent) {
      if (current && indent === current.indent) flush();
      if (!current) current = { lines: [raw], indent };
      else current.lines.push(raw);
      continue;
    }

    if (current) current.lines.push(raw);
  }
  flush();
  return steps;
};

const findStepShellEnvViolations = (workflow: string) => {
  const violations: string[] = [];
  for (const step of collectBlockSteps(workflow)) {
    const tainted = new Set<string>();
    let envIndent: number | null = null;
    let shell = '';
    let shellIndent: number | null = null;
    let shellBlockIndent: number | null = null;

    for (let index = 0; index < step.lines.length; index += 1) {
      const raw = step.lines[index];
      const line = stripYamlComment(raw);
      const trimmed = line.trim();
      const indent = indentOf(raw);
      if (!trimmed) continue;

      if (envIndent !== null && indent <= envIndent) envIndent = null;
      if (/^["']?env["']?\s*:\s*$/.test(trimmed)) { envIndent = indent; continue; }
      if (envIndent !== null && indent > envIndent) {
        const assignment = trimmed.match(/^(?:["']?)([A-Za-z_][A-Za-z0-9_]*)(?:["']?)\s*:\s*(.+)$/);
        if (assignment && containsUntrustedText(assignment[2])) tainted.add(assignment[1]);
      }

      const shellMatch = trimmed.match(/^["']?shell["']?\s*:\s*(.*)$/);
      if (shellMatch) {
        const value = shellMatch[1].trim();
        shellIndent = indent;
        if (/^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/.test(value)) shellBlockIndent = indent;
        else shell = value;
        continue;
      }
      if (shellBlockIndent !== null) {
        if (indent <= shellBlockIndent) { shellBlockIndent = null; }
        else { shell += `${shell ? '\n' : ''}${trimmed}`; continue; }
      }
      if (shellIndent !== null && indent <= shellIndent && !shellMatch) shellIndent = null;
    }

    for (const name of tainted) if (shellReferencesEnv(shell, name)) violations.push(`${name}: ${shell}`);
  }
  return violations;
};

const expectSafeCustomShellEnv = (workflow: string, source: string) => {
  expect(findStepShellEnvViolations(workflow), source).toEqual([]);
};

describe('GitHub workflow custom-shell environment taint policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectSafeCustomShellEnv(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects attacker-controlled step env interpolated through an env expression', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - env:',
      '          CMD: ${{ github.event.comment.body }}',
      "        shell: bash -c '${{ env.CMD }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeCustomShellEnv(unsafe, 'env-expression.yml')).toThrow();
  });

  it('rejects attacker-controlled step env expanded as a shell variable', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - env:',
      '          CMD: ${{ github.event.issue.body }}',
      '        shell: bash -c "$CMD" -- {0}',
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeCustomShellEnv(unsafe, 'env-shell-variable.yml')).toThrow();
  });

  it('allows tainted step env when the custom shell template does not execute it', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - env:',
      '          MESSAGE: ${{ github.event.comment.body }}',
      '        shell: bash --noprofile --norc -e -o pipefail {0}',
      '        run: printf "%s\\n" "$MESSAGE"',
    ].join('\n');
    expectSafeCustomShellEnv(safe, 'safe-data.yml');
  });
});
