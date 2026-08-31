import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableSha = /^[0-9a-f]{40}$/i;

const decodeKey = (raw: string) => {
  const key = raw.trim().replace(/^(?:(?:&[^\s]+|![^\s]*|!![^\s]+)\s+)*/, '');
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key); } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const isBlockScalarHeader = (raw: string) =>
  /^(?:(?:&[^\s]+|![^\s]*|!![^\s]+)\s+)*(?:[|>](?:[1-9]?[+-]?|[+-]?[1-9]?))\s*(?:#.*)?$/.test(raw.trim());

const withoutBlockScalarBodies = (workflow: string) => {
  const lines = workflow.split('\n');
  const structural: string[] = [];
  let scalarIndent: number | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) {
        structural.push('');
        continue;
      }
      scalarIndent = null;
    }

    structural.push(raw);
    const scalarHeader = trimmed.match(/:\s*(?:(?:&[^\s]+|![^\s]*|!![^\s]+)\s+)*(?:[|>](?:[1-9]?[+-]?|[+-]?[1-9]?))\s*(?:#.*)?$/);
    if (scalarHeader) scalarIndent = indent;
  }

  return structural.join('\n');
};

const collectBlockScalarExplicitKey = (lines: string[], keyIndex: number, keyIndent: number) => {
  const body: string[] = [];
  let valueIndex = -1;

  for (let index = keyIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (!trimmed) continue;
    if (indent > keyIndent) {
      body.push(trimmed);
      continue;
    }
    if (indent === keyIndent && /^:\s*/.test(trimmed)) valueIndex = index;
    break;
  }

  return { key: body.join('\n').trim(), valueIndex };
};

const collectAnchoredBlockActionRefs = (workflow: string) => {
  const lines = withoutBlockScalarBodies(workflow).split('\n');
  const anchors = new Map<string, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const head = lines[index].match(/^(\s*)-\s*&([^\s\[\]{},]+)\s*$/);
    if (!head) continue;
    const indent = head[1].length;

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const childIndent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (!trimmed) continue;
      if (childIndent <= indent) break;

      const explicit = trimmed.match(/^\?\s+(.+?)\s*$/);
      if (explicit) {
        let key = decodeKey(explicit[1]);
        let valueIndex = child + 1;
        if (isBlockScalarHeader(explicit[1])) {
          const scalarKey = collectBlockScalarExplicitKey(lines, child, childIndent);
          key = scalarKey.key;
          valueIndex = scalarKey.valueIndex;
        }
        if (key === 'uses' && valueIndex >= 0) {
          const valueLine = lines[valueIndex]?.trim() ?? '';
          const value = valueLine.match(/^:\s*(\S+)\s*$/)?.[1];
          if (value) anchors.set(head[2], value);
          break;
        }
      }

      const implicit = trimmed.match(/^(.+?)\s*:\s*(\S+)\s*$/);
      if (implicit && decodeKey(implicit[1]) === 'uses') {
        anchors.set(head[2], implicit[2]);
        break;
      }
    }
  }

  return anchors;
};

const collectStepAliases = (workflow: string) => {
  const aliases = new Set<string>();
  const lines = withoutBlockScalarBodies(workflow).split('\n');
  let stepsIndent: number | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    if (/^steps\s*:/.test(trimmed)) {
      stepsIndent = indent;
      for (const match of trimmed.matchAll(/\*([^\s\[\]{},]+)/g)) aliases.add(match[1]);
      continue;
    }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }
    const alias = trimmed.match(/^-?\s*\*([^\s\[\]{},]+)\s*,?$/)?.[1];
    if (alias) aliases.add(alias);
  }
  return aliases;
};

const expectAliasedBlockActionsPinned = (workflow: string, source: string) => {
  const anchors = collectAnchoredBlockActionRefs(workflow);
  for (const alias of collectStepAliases(workflow)) {
    const ref = anchors.get(alias);
    if (!ref || ref.startsWith('./')) continue;
    const revision = ref.slice(ref.lastIndexOf('@') + 1);
    expect(immutableSha.test(revision), `${source}: aliased action ${alias} must use an immutable SHA`).toBe(true);
  }
};

describe('GitHub workflow block-mapping aliased step policy', () => {
  it('enforces immutable refs for every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectAliasedBlockActionsPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects an anchored block mapping with an explicit decorated mutable uses key', () => {
    const unsafe = [
      'strategy:',
      '  matrix:',
      '    include:',
      '      - &checkout',
      '        ? !!str uses',
      '        : actions/checkout@v4',
      'steps:',
      '  - *checkout',
    ].join('\n');
    expect(() => expectAliasedBlockActionsPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects an aliased step whose explicit block-scalar key decodes to uses', () => {
    const unsafe = [
      'strategy:',
      '  matrix:',
      '    include:',
      '      - &checkout',
      '        ? |-',
      '          uses',
      '        : actions/checkout@v4',
      'steps:',
      '  - *checkout',
    ].join('\n');
    expect(() => expectAliasedBlockActionsPinned(unsafe, 'block-key.yml')).toThrow();
  });

  it('accepts the same aliased block mapping when pinned to a full commit SHA', () => {
    const safe = [
      'strategy:',
      '  matrix:',
      '    include:',
      '      - &checkout',
      '        ? !!str uses',
      '        : actions/checkout@0123456789abcdef0123456789abcdef01234567',
      'steps:',
      '  - *checkout',
    ].join('\n');
    expect(() => expectAliasedBlockActionsPinned(safe, 'safe.yml')).not.toThrow();
  });

  it('ignores action-shaped anchors and aliases inside block-scalar scripts', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      "          cat <<'YAML'",
      '          - &checkout',
      '            uses: actions/checkout@v4',
      '          steps: [*checkout]',
      '          YAML',
    ].join('\n');
    expect(() => expectAliasedBlockActionsPinned(safe, 'script.yml')).not.toThrow();
  });
});
