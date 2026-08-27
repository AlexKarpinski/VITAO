import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableActionRef = /^[^@\s]+@[0-9a-f]{40}$/;
const stripComment = (line: string) => line.replace(/\s+#.*$/, '');
const isActionStepContext = (line: string) => /^\s*-\s*\{/.test(line) || /\bsteps\s*:\s*\[/.test(line);
const isBlockHeader = (value: string) => /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)$/.test(value.trim());
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const extractTargetedActionRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let ignoredBlockIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    const indent = indentOf(rawLine);

    if (ignoredBlockIndent !== null) {
      if (!trimmed || indent > ignoredBlockIndent) continue;
      ignoredBlockIndent = null;
    }

    const canonical = line.match(/^\s*(?:-\s*)?uses\s*:\s*(.*)$/);
    if (canonical) {
      const value = canonical[1].trim();
      if (isBlockHeader(value)) {
        const parentIndent = indent;
        const folded: string[] = [];
        for (let child = index + 1; child < lines.length; child += 1) {
          const childLine = stripComment(lines[child]);
          const childTrimmed = childLine.trim();
          const childIndent = indentOf(lines[child]);
          if (childTrimmed && childIndent <= parentIndent) break;
          if (childTrimmed) folded.push(childTrimmed);
          index = child;
        }
        if (folded.length) refs.push(folded.join(' '));
      }
      continue;
    }

    const outerScalar = line.match(/^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(\S+)\s*$/);
    if (outerScalar && isBlockHeader(outerScalar[1])) {
      ignoredBlockIndent = indent;
      continue;
    }

    if (!isActionStepContext(line)) continue;
    for (const match of line.matchAll(/(?:^|[{,])\s*uses\s*:\s*([^,}\s]+)/g)) {
      refs.push(match[1]);
    }
  }

  return refs;
};

const expectTargetedRefsImmutable = (workflow: string, source: string) => {
  for (const ref of extractTargetedActionRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableActionRef);
  }
};

describe('GitHub workflow deferred YAML action pinning edge policy', () => {
  it('keeps alternate valid block-scalar indicator ordering under immutable pinning', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    for (const header of ['>2+', '>+2', '|2-', '|-2']) {
      const pinned = `steps:\n  - uses: ${header}\n      actions/checkout@${sha}`;
      const mutable = `steps:\n  - uses: ${header}\n      actions/checkout@v4`;
      expect(extractTargetedActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
      expectTargetedRefsImmutable(pinned, 'pinned-block.yml');
      expect(() => expectTargetedRefsImmutable(mutable, 'mutable-block.yml')).toThrow();
    }
  });

  it('does not treat uses-like keys in unrelated flow mappings as action steps', () => {
    const unrelated = [
      'env: { uses: actions/checkout@v4 }',
      'with: { uses: actions/setup-node@v4 }',
      'metadata: { uses: actions/cache@v4 }',
    ].join('\n');
    expect(extractTargetedActionRefs(unrelated)).toEqual([]);
    expectTargetedRefsImmutable(unrelated, 'unrelated-flow.yml');
  });

  it('ignores uses-like action examples nested inside outer block scalars', () => {
    const documentation = [
      'jobs:',
      '  demo:',
      '    steps:',
      '      - run: |',
      '          Example configuration:',
      '          uses: >-',
      '            actions/checkout@v4',
      '      - run: echo safe',
    ].join('\n');
    expect(extractTargetedActionRefs(documentation)).toEqual([]);
    expectTargetedRefsImmutable(documentation, 'block-scalar-docs.yml');
  });

  it('still enforces immutable refs in actual flow-style step contexts', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `steps: [{ uses: actions/checkout@${sha} }]`;
    const mutable = 'steps: [{ uses: actions/checkout@v4 }]';
    expect(extractTargetedActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expect(() => expectTargetedRefsImmutable(mutable, 'mutable-flow-step.yml')).toThrow();
  });

  it('applies the targeted edge checks to every repository workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectTargetedRefsImmutable(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
