import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const usesRefs = (sequence: string) => {
  const refs: string[] = [];
  for (const match of sequence.matchAll(/(?:^|[\[{,])\s*(?:"uses"|'uses'|uses)\s*:\s*("[^"]+"|'[^']+'|[^,}\]\s]+)/g)) {
    refs.push(match[1].replace(/^['"]|['"]$/g, ''));
  }
  return refs;
};

const collectExplicitStepsAliasRefs = (workflow: string) => {
  const lines = workflow.split('\n');
  const sequenceAnchors = new Map<string, string[]>();
  const refs: string[] = [];
  let blockScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = stripYamlComment(raw);
    const trimmed = line.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (/:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    const anchored = line.match(/&([A-Za-z0-9_-]+)\s*(\[[\s\S]*\])\s*$/);
    if (anchored) sequenceAnchors.set(anchored[1], usesRefs(anchored[2]));

    if (!/^\s*(?:-\s*)?\?\s*(?:"steps"|'steps'|steps)\s*$/.test(line)) continue;
    for (let child = index + 1; child < lines.length; child += 1) {
      const valueLine = stripYamlComment(lines[child]);
      if (!valueLine.trim()) continue;
      const value = valueLine.match(/^\s*:\s*\*([A-Za-z0-9_-]+)\s*$/);
      if (value) refs.push(...(sequenceAnchors.get(value[1]) ?? []));
      break;
    }
  }

  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectExplicitStepsAliasRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('explicit steps sequence-alias action pinning', () => {
  it('rejects mutable actions reached through an explicit steps alias', () => {
    const workflow = [
      'x-common: &common [{ uses: actions/checkout@v4 }]',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    ? steps',
      '    : *common',
    ].join('\n');
    expect(() => expectPinned(workflow, 'mutable-explicit-alias.yml')).toThrow();
  });

  it('accepts immutable actions reached through an explicit steps alias', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const workflow = [
      `x-common: &common [{ uses: actions/checkout@${sha} }]`,
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    ? steps',
      '    : *common',
    ].join('\n');
    expect(collectExplicitStepsAliasRefs(workflow)).toEqual([`actions/checkout@${sha}`]);
    expectPinned(workflow, 'pinned-explicit-alias.yml');
  });

  it('ignores alias-shaped examples inside block scalars', () => {
    const workflow = [
      'DOC: |',
      '  x-common: &common [{ uses: actions/checkout@v4 }]',
      '  ? steps',
      '  : *common',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectExplicitStepsAliasRefs(workflow)).toEqual([]);
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });
});
