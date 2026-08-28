import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedEventObjects = new Set(['comment', 'issue', 'pull_request', 'review', 'discussion']);

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

const computedEventObjects = (script: string) => {
  const objects: string[] = [];
  const pattern = /github(?:\.event|\[['"]event['"]\])\s*\[\s*format\s*\(((?:'(?:''|[^'])*'\s*,?\s*)+)\)\s*\]/gi;
  for (const match of script.matchAll(pattern)) {
    const resolved = resolveFormat(match[1]);
    if (resolved) objects.push(resolved);
  }
  return objects;
};

const inlineRunValues = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?(?:run|["']run["'])\s*:\s*(.+)$/)?.[1] ?? null)
    .filter((value): value is string => value !== null && !/^[>|]/.test(value.trim()));

const expectNoComputedUntrustedEventShellUse = (workflow: string, source: string) => {
  for (const script of inlineRunValues(workflow)) {
    for (const object of computedEventObjects(script)) {
      expect(
        untrustedEventObjects.has(object),
        `${source}: computed event property ${object} reaches a shell run step`,
      ).toBe(false);
    }
  }
};

describe('computed GitHub event shell-boundary policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoComputedUntrustedEventShellUse(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a computed comment object used by a shell run step', () => {
    const unsafe = [
      'steps:',
      "  - run: bash -c '${{ github.event[format('{0}{1}', 'com', 'ment')].body }}'",
    ].join('\n');
    expect(() => expectNoComputedUntrustedEventShellUse(unsafe, 'computed-event.yml')).toThrow();
  });

  it('allows a computed trusted event property when it is not user-authored text', () => {
    const safe = [
      'steps:',
      "  - run: echo '${{ github.event[format('{0}', 'action')] }}'",
    ].join('\n');
    expectNoComputedUntrustedEventShellUse(safe, 'computed-event-safe.yml');
  });
});
