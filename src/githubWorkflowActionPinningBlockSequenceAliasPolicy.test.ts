import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^\s@]+@[0-9a-f]{40}$/i;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripComment = (line: string) => {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
  }
  return line;
};

const cleanRef = (value: string) => stripComment(value).trim().replace(/^['"]|['"]$/g, '');

const collectBlockSequenceAnchors = (workflow: string) => {
  const lines = workflow.split('\n');
  const anchors = new Map<string, string[]>();

  for (let index = 0; index < lines.length; index += 1) {
    const declaration = stripComment(lines[index]).match(/^(\s*).*&([A-Za-z0-9_-]+)\s*$/);
    if (!declaration) continue;
    const anchorIndent = declaration[1].length;
    const refs: string[] = [];

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = stripComment(lines[child]);
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const indent = indentOf(raw);
      if (indent <= anchorIndent) break;

      const implicit = trimmed.match(/^-?\s*(?:(?:&[A-Za-z0-9_-]+|!![^\s]+|![^\s]*)\s+)*['"]?uses['"]?\s*:\s*(.+)$/);
      if (implicit) {
        refs.push(cleanRef(implicit[1]));
        continue;
      }

      const explicit = trimmed.match(/^-?\s*\?\s*(?:(?:&[A-Za-z0-9_-]+|!![^\s]+|![^\s]*)\s+)*['"]?uses['"]?\s*$/);
      if (!explicit) continue;
      for (let valueLine = child + 1; valueLine < lines.length; valueLine += 1) {
        const valueRaw = stripComment(lines[valueLine]);
        if (!valueRaw.trim()) continue;
        if (indentOf(valueRaw) <= anchorIndent) break;
        const value = valueRaw.trim().match(/^:\s*(.+)$/);
        if (value) refs.push(cleanRef(value[1]));
        break;
      }
    }

    if (refs.length > 0) anchors.set(declaration[2], refs);
  }

  return anchors;
};

const collectStepSequenceAliases = (workflow: string) => {
  const aliases = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = stripComment(line).match(/^\s*['"]?steps['"]?\s*:\s*\*([A-Za-z0-9_-]+)\s*$/);
    if (match) aliases.add(match[1]);
  }
  return aliases;
};

const expectPinnedBlockSequenceAliases = (workflow: string, source: string) => {
  const anchors = collectBlockSequenceAnchors(workflow);
  for (const alias of collectStepSequenceAliases(workflow)) {
    for (const ref of anchors.get(alias) ?? []) {
      expect(ref, `${source}: action ${ref} reached executable steps through block-sequence alias *${alias}`).toMatch(immutableRef);
    }
  }
};

describe('action pinning for block-sequence aliases used as steps', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedBlockSequenceAliases(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable action inside a block sequence aliased as steps', () => {
    const unsafe = [
      'x-matrix:',
      '  include: &common',
      '    - ? !!str uses',
      '      : actions/checkout@v4',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: *common',
    ].join('\n');
    expect(() => expectPinnedBlockSequenceAliases(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts an immutable action inside the same block-sequence alias shape', () => {
    const safe = [
      'x-matrix:',
      '  include: &common',
      '    - ? !!str uses',
      '      : actions/checkout@0123456789abcdef0123456789abcdef01234567',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps: *common',
    ].join('\n');
    expectPinnedBlockSequenceAliases(safe, 'safe.yml');
  });

  it('does not enforce a block sequence that is never used as executable steps', () => {
    const dataOnly = [
      'metadata:',
      '  examples: &docs',
      '    - uses: actions/checkout@v4',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectPinnedBlockSequenceAliases(dataOnly, 'docs.yml');
  });
});
