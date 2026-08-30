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

const parseExpressionString = (raw: string) => {
  const trimmed = raw.trim();
  const single = parseSingleQuoted(trimmed);
  if (single !== null) return single;
  if (!/^"(?:\\.|[^"\\])*"$/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return null;
  }
};

const resolveFromJson = (raw: string) => {
  const encoded = parseExpressionString(raw);
  if (encoded === null) return null;
  try {
    const value = JSON.parse(encoded) as unknown;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
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

const computedEventLeaves = (script: string) => {
  const leaves: Array<{ object: string; leaf: string }> = [];
  const formatPattern = /github(?:\.event|\[['"]event['"]\])(?:\.([A-Za-z_][A-Za-z0-9_-]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\])\s*\[\s*format\s*\(((?:'(?:''|[^'])*'\s*,?\s*)+)\)\s*\]/gi;
  for (const match of script.matchAll(formatPattern)) {
    const leaf = resolveFormat(match[3]);
    const object = match[1] ?? match[2];
    if (object && leaf) leaves.push({ object, leaf });
  }

  const fromJsonPattern = /github(?:\.event|\[['"]event['"]\])(?:\.([A-Za-z_][A-Za-z0-9_-]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\])\s*\[\s*fromJSON\s*\(\s*((?:'(?:''|[^'])*')|(?:"(?:\\.|[^"\\])*"))\s*\)\s*\]/gi;
  for (const match of script.matchAll(fromJsonPattern)) {
    const leaf = resolveFromJson(match[3]);
    const object = match[1] ?? match[2];
    if (object && leaf) leaves.push({ object, leaf });
  }
  return leaves;
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
    for (const { object, leaf } of computedEventLeaves(script)) {
      expect(
        untrustedEventObjects.has(object) && untrustedComputedLeaves.has(leaf),
        `${source}: computed ${object}.${leaf} event text reaches a shell run step`,
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

  it('rejects a computed leaf beneath an untrusted event object', () => {
    const unsafe = [
      'steps:',
      "  - run: bash -c \"${{ github.event.comment[format('{0}{1}', 'bo', 'dy')] }}\"",
    ].join('\n');
    expect(() => expectNoComputedUntrustedEventShellUse(unsafe, 'computed-leaf.yml')).toThrow();
  });

  it('rejects a fromJSON-computed leaf beneath an untrusted event object', () => {
    const unsafe = [
      'steps:',
      "  - run: bash -c \"${{ github.event.comment[fromJSON('\"body\"')] }}\"",
    ].join('\n');
    expect(() => expectNoComputedUntrustedEventShellUse(unsafe, 'computed-fromjson-leaf.yml')).toThrow();
  });

  it('allows computed trusted event properties when they are not user-authored text', () => {
    const safe = [
      'steps:',
      "  - run: echo '${{ github.event[format('{0}', 'action')] }}'",
      "  - run: echo '${{ github.event.comment[format('{0}', 'id')] }}'",
      "  - run: echo \"${{ github.event.comment[fromJSON('\"id\"')] }}\"",
    ].join('\n');
    expectNoComputedUntrustedEventShellUse(safe, 'computed-event-safe.yml');
  });
});
