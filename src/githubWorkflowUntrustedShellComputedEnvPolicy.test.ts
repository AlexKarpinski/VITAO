import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedSource = /github(?:\.event|\[['"]event['"]\]).*(?:issue|comment|pull_request|review|discussion).*?(?:title|body|head\.ref|head\[['"]ref['"])/;
const envEntry = /^\s*(?:["']?)([A-Za-z_][A-Za-z0-9_]*)(?:["']?)\s*:\s*(.+)$/;

const collectTaintedEnv = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(envEntry);
    if (match && untrustedSource.test(match[2])) names.add(match[1]);
  }
  return names;
};

const parseSingleQuoted = (raw: string) => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^'((?:''|[^'])*)'$/);
  return match ? match[1].replace(/''/g, "'") : null;
};

const splitArguments = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      if (quoted && value[index + 1] === "'") { index += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      args.push(value.slice(start, index));
      start = index + 1;
    }
  }
  args.push(value.slice(start));
  return args;
};

const resolveFormat = (call: string) => {
  const args = splitArguments(call).map(parseSingleQuoted);
  if (args.some((arg) => arg === null) || args.length === 0) return null;
  let result = args[0] as string;
  for (let index = 1; index < args.length; index += 1) {
    result = result.replaceAll(`{${index - 1}}`, args[index] as string);
  }
  return result;
};

const resolveFromJson = (argument: string) => {
  const literal = parseSingleQuoted(argument);
  if (literal === null) return null;
  try {
    const parsed: unknown = JSON.parse(literal);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const computedEnvNames = (workflow: string) => {
  const names: string[] = [];
  const formatPattern = /env\s*\[\s*format\s*\(((?:'(?:''|[^'])*'\s*,?\s*)+)\)\s*\]/gi;
  for (const match of workflow.matchAll(formatPattern)) {
    const resolved = resolveFormat(match[1]);
    if (resolved) names.push(resolved);
  }
  const fromJsonPattern = /env\s*\[\s*fromJSON\s*\(\s*('(?:''|[^'])*')\s*\)\s*\]/gi;
  for (const match of workflow.matchAll(fromJsonPattern)) {
    const resolved = resolveFromJson(match[1]);
    if (resolved) names.push(resolved);
  }
  return names;
};

const expectNoComputedTaintedEnv = (workflow: string, source: string) => {
  const tainted = collectTaintedEnv(workflow);
  for (const name of computedEnvNames(workflow)) {
    expect(tainted.has(name), `${source}: computed env reference resolves to tainted ${name}`).toBe(false);
  }
};

describe('computed GitHub env shell-boundary policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoComputedTaintedEnv(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects format-computed access to a tainted environment variable', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      `  - run: bash -c "\${{ env[format('C{0}D', 'M')] }}"`,
    ].join('\n');
    expect(() => expectNoComputedTaintedEnv(unsafe, 'computed-env.yml')).toThrow();
  });

  it('rejects fromJSON-computed access to a tainted environment variable', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      `  - run: bash -c "\${{ env[fromJSON('\"CMD\"')] }}"`,
    ].join('\n');
    expect(() => expectNoComputedTaintedEnv(unsafe, 'computed-env-from-json.yml')).toThrow();
  });

  it('allows computed access to a constant environment variable', () => {
    const safe = [
      'env:',
      '  CMD: echo safe',
      'steps:',
      `  - run: bash -c "\${{ env[format('C{0}D', 'M')] }}"`,
      `  - run: bash -c "\${{ env[fromJSON('\"CMD\"')] }}"`,
    ].join('\n');
    expectNoComputedTaintedEnv(safe, 'computed-env-safe.yml');
  });
});
