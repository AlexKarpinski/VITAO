import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedEventObjects = new Set(['comment', 'issue', 'pull_request', 'review', 'discussion']);
const untrustedComputedLeaves = new Set(['body', 'title', 'diff_hunk']);

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
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
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
  if (args.length === 0 || args.some((arg) => arg === null)) return null;
  let result = args[0] as string;
  for (let index = 1; index < args.length; index += 1) {
    result = result.replaceAll(`{${index - 1}}`, args[index] as string);
  }
  return result;
};

const containsComputedUntrustedEvent = (value: string) => {
  const objectPattern = /github(?:\.event|\[['"]event['"]\])\s*\[\s*format\s*\(((?:'(?:''|[^'])*'\s*,?\s*)+)\)\s*\]/gi;
  for (const match of value.matchAll(objectPattern)) {
    const object = resolveFormat(match[1]);
    if (object && untrustedEventObjects.has(object)) return true;
  }

  const leafPattern = /github(?:\.event|\[['"]event['"]\])(?:\.([A-Za-z_][A-Za-z0-9_-]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\])\s*\[\s*format\s*\(((?:'(?:''|[^'])*'\s*,?\s*)+)\)\s*\]/gi;
  for (const match of value.matchAll(leafPattern)) {
    const object = match[1] ?? match[2];
    const leaf = resolveFormat(match[3]);
    if (object && leaf && untrustedEventObjects.has(object) && untrustedComputedLeaves.has(leaf)) {
      return true;
    }
  }
  return false;
};

const collectComputedEventEnvBindings = (workflow: string) => {
  const bindings = new Map<string, string[]>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (/^env\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }

    if (envIndent === null) continue;
    if (!trimmed) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) continue;
    const values = bindings.get(match[1]) ?? [];
    values.push(match[2]);
    bindings.set(match[1], values);
  }

  return new Set(
    [...bindings.entries()]
      .filter(([, values]) => values.length > 0 && values.every(containsComputedUntrustedEvent))
      .map(([name]) => name),
  );
};

const runScripts = (workflow: string) => {
  const scripts: string[] = [];
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*(?:-\s*)?(?:run|["']run["'])\s*:\s*(.+)$/);
    if (match) scripts.push(match[1]);
  }
  return scripts;
};

const executesEnvironmentValue = (script: string, name: string) => {
  const executionSink = /\b(?:bash|sh)\s+-c\b|\beval\b|\bInvoke-Expression\b/i;
  if (!executionSink.test(script)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\$\\{?${escaped}(?:\\}|\\b)|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`,
    'i',
  ).test(script);
};

const expectNoComputedEventEnvShellUse = (workflow: string, source: string) => {
  const taintedEnv = collectComputedEventEnvBindings(workflow);
  for (const script of runScripts(workflow)) {
    for (const name of taintedEnv) {
      expect(
        executesEnvironmentValue(script, name),
        `${source}: computed event text reaches a shell execution sink through env.${name}`,
      ).toBe(false);
    }
  }
};

describe('computed GitHub event environment shell-boundary policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoComputedEventEnvShellUse(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a computed comment leaf propagated through an environment variable', () => {
    const unsafe = [
      'jobs:',
      '  check:',
      '    env:',
      "      CMD: ${{ github.event.comment[format('{0}{1}', 'bo', 'dy')] }}",
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoComputedEventEnvShellUse(unsafe, 'computed-env.yml')).toThrow();
  });

  it('allows a constant environment command', () => {
    const safe = [
      'jobs:',
      '  check:',
      '    env:',
      '      CMD: echo safe',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expectNoComputedEventEnvShellUse(safe, 'computed-env-safe.yml');
  });

  it('allows computed event text used only as quoted data', () => {
    const safe = [
      'jobs:',
      '  check:',
      '    env:',
      "      BODY: ${{ github.event.comment[format('{0}{1}', 'bo', 'dy')] }}",
      '    steps:',
      "      - run: printf '%s\\n' \"$BODY\"",
    ].join('\n');
    expectNoComputedEventEnvShellUse(safe, 'computed-env-data.yml');
  });
});
