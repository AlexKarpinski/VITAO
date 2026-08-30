import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const stripComment = (value: string) => value.replace(/\s+#.*$/, '').trim();
const stripNodeProperties = (raw: string) => {
  let value = stripComment(raw);
  while (/^(?:!![A-Za-z0-9_-]+|![A-Za-z0-9_!-]+|!<[^>]+>)\s+/.test(value)) {
    value = value.replace(/^(?:!![A-Za-z0-9_-]+|![A-Za-z0-9_!-]+|!<[^>]+>)\s+/, '');
  }
  return value.trim();
};
const decodeScalar = (raw: string) => {
  const value = stripNodeProperties(raw);
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};
const unquote = (raw: string) => {
  const value = stripComment(raw).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const collectAliasedUsesRefs = (workflow: string) => {
  const aliases = new Map<string, string>();
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    const anchor = trimmed.match(/^[^:#]+:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+)$/);
    if (anchor) aliases.set(anchor[1], decodeScalar(anchor[2]));

    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) { stepsIndent = indent; continue; }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) { stepsIndent = null; continue; }

    const flow = trimmed.match(/^-\s+(?:(?:&|!)[^\s{}]+\s+)*\{(.+)\}\s*$/);
    if (!flow) continue;
    for (const mapping of flow[1].matchAll(/\*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([^,}]+)/g)) {
      if (aliases.get(mapping[1]) === 'uses') refs.push(unquote(mapping[2]));
    }
  }
  return refs;
};

const expectImmutableAliasedUsesRefs = (workflow: string, source: string) => {
  for (const ref of collectAliasedUsesRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('tagged anchored YAML keys in action steps', () => {
  it('enforces tagged anchored uses keys across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableAliasedUsesRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable action behind a tagged anchored uses key', () => {
    const mutable = [
      'x-key: &use-key !!str uses',
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { *use-key: actions/checkout@v4 }',
    ].join('\n');
    expect(collectAliasedUsesRefs(mutable)).toEqual(['actions/checkout@v4']);
    expect(() => expectImmutableAliasedUsesRefs(mutable, 'tagged-key.yml')).toThrow();
  });

  it('accepts an immutable action behind a tagged anchored uses key', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = [
      'x-key: &use-key !!str uses',
      'jobs:',
      '  build:',
      '    steps:',
      `      - &checkout { *use-key: actions/checkout@${sha} }`,
    ].join('\n');
    expect(collectAliasedUsesRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableAliasedUsesRefs(pinned, 'tagged-key.yml');
  });
});
