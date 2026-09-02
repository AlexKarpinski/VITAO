import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedExpression = /\$\{\{\s*(?:github\.event\.(?:comment|issue|pull_request|review)\.body|github\.event\.head_commit\.message|github\.event\.pages(?:\[[^\]]+\]|\.\*)\.page_name)\s*\}\}/;
const executionSink = /(?:\beval\b|\bbash\s+-c\b|\bsh\s+-c\b|\bzsh\s+-c\b|\bexec\b)/;

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
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index);
  }
  return value;
};

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const flowMappingBody = (source: string, key: string) => {
  const match = source.match(new RegExp(`(?:^|[,{}])\\s*${key}\\s*:\\s*\\{`));
  if (!match || match.index === undefined) return null;
  const opening = source.indexOf('{', match.index + match[0].lastIndexOf('{'));
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let backslashes = 0;
  for (let index = opening; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(opening + 1, index);
    }
  }
  return null;
};

const taintedFlowEnvNames = (source: string) => {
  const body = flowMappingBody(source, 'env');
  if (body === null) return new Set<string>();
  const names = new Set<string>();
  for (const entry of splitTopLevel(body)) {
    const pair = entry.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/);
    if (pair && untrustedExpression.test(pair[2])) names.add(pair[1]);
  }
  return names;
};

const runValue = (source: string) => {
  const match = source.match(/(?:^|[,{}])\s*run\s*:\s*(.+?)(?=\s*[,}]|$)/);
  return match?.[1]?.trim() ?? null;
};

const referencesEnvName = (command: string, name: string) =>
  new RegExp(`(?:\\$${name}\\b|\\$\\{${name}(?::[-+?=][^}]*)?\\}|\\$\\{\\{\\s*env\\.${name}\\s*\\}\\})`).test(command);

const flowEnvShellViolations = (workflow: string) => {
  const violations: string[] = [];
  const lines = workflow.split('\n');
  let blockScalarIndent: number | null = null;
  let pendingTainted = new Set<string>();
  let pendingIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = stripYamlComment(rawLine);
    const trimmed = line.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (/:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    if (pendingIndent !== null && trimmed && indent <= pendingIndent) {
      pendingTainted = new Set<string>();
      pendingIndent = null;
    }

    const taintedHere = taintedFlowEnvNames(line);
    if (taintedHere.size > 0) {
      pendingTainted = taintedHere;
      pendingIndent = indent;
    }

    const command = runValue(line) ?? (/^run\s*:\s*(.+)$/.exec(trimmed)?.[1] ?? null);
    if (!command || !executionSink.test(command)) continue;
    const active = new Set([...pendingTainted, ...taintedHere]);
    for (const name of active) if (referencesEnvName(command, name)) violations.push(name);
  }
  return violations;
};

const expectNoFlowEnvShellInjection = (workflow: string, source: string) => {
  expect(flowEnvShellViolations(workflow), source).toEqual([]);
};

describe('flow-style environment shell-taint policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoFlowEnvShellInjection(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects untrusted flow-style env values executed by a shell sink', () => {
    const unsafe = `steps: [{ env: { CMD: \${{ github.event.comment.body }} }, run: bash -c "$CMD" }]`;
    expect(flowEnvShellViolations(unsafe)).toEqual(['CMD']);
    expect(() => expectNoFlowEnvShellInjection(unsafe, 'flow-env.yml')).toThrow();
  });

  it('propagates a flow-style env mapping into the following block run key', () => {
    const unsafe = ['steps:', '  - env: { CMD: ${{ github.event.issue.body }} }', '    run: eval "$CMD"'].join('\n');
    expect(flowEnvShellViolations(unsafe)).toEqual(['CMD']);
  });

  it('allows constants and data-only output', () => {
    const constant = `steps: [{ env: { CMD: echo-safe }, run: bash -c "$CMD" }]`;
    const dataOnly = `steps: [{ env: { CMD: \${{ github.event.comment.body }} }, run: printf '%s\\n' "$CMD" }]`;
    expectNoFlowEnvShellInjection(constant, 'constant.yml');
    expectNoFlowEnvShellInjection(dataOnly, 'data-only.yml');
  });

  it('ignores flow-shaped examples inside block scalars', () => {
    const safe = ['env:', '  DOC: |', '    steps: [{ env: { CMD: ${{ github.event.comment.body }} }, run: bash -c "$CMD" }]', 'steps:', '  - run: echo safe'].join('\n');
    expectNoFlowEnvShellInjection(safe, 'documentation.yml');
  });
});
