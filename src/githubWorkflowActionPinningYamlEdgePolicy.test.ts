import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableActionRef = /^[^@\s]+@[0-9a-f]{40}$/;
const stripComment = (line: string) => line.replace(/\s+#.*$/, '');
const structuralLine = (line: string) => {
  let quote: '"' | "'" | null = null;
  let structural = '';

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === "'" && char === "'" && line[index + 1] === "'") {
        structural += '  ';
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === "'") quote = null;
        else {
          let backslashes = 0;
          for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = null;
        }
      }
      structural += ' ';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      structural += ' ';
      continue;
    }
    structural += char;
  }

  return structural;
};
const flowStepsSource = (line: string) => {
  const structural = structuralLine(line);
  const steps = /\bsteps\s*:\s*\[/.exec(structural);
  if (!steps) return null;
  const opening = structural.indexOf('[', steps.index);
  if (opening < 0) return null;

  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let index = opening; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (quote === "'" && char === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === quote) {
        if (quote === "'") quote = null;
        else {
          let backslashes = 0;
          for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1) backslashes += 1;
          if (backslashes % 2 === 0) quote = null;
        }
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return line.slice(opening, index + 1);
    }
  }

  return line.slice(opening);
};
const actionStepSource = (line: string) => /^\s*-\s*\{/.test(line) ? line : flowStepsSource(line);
const stripNodeProperties = (value: string) => value.trim().replace(/^(?:(?:&[A-Za-z0-9_.-]+|![^\s]+)\s+)+/, '');
const isBlockHeader = (value: string) => /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)$/.test(stripNodeProperties(value));
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const isSimpleYamlKey = (value: string) =>
  /^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)$/.test(value);

const extractTargetedActionRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let ignoredBlockIndent: number | null = null;
  let explicitOuterKeyIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    const indent = indentOf(rawLine);

    if (ignoredBlockIndent !== null) {
      if (!trimmed || indent > ignoredBlockIndent) continue;
      ignoredBlockIndent = null;
    }

    if (explicitOuterKeyIndent !== null) {
      const explicitValue = trimmed.match(/^:\s*(.+?)\s*$/);
      if (indent >= explicitOuterKeyIndent && explicitValue && isBlockHeader(explicitValue[1])) {
        ignoredBlockIndent = indent;
        explicitOuterKeyIndent = null;
        continue;
      }
      if (trimmed) explicitOuterKeyIndent = null;
    }

    const explicitOuterKey = trimmed.match(/^(?:-\s*)?\?\s+(.+?)\s*$/);
    if (explicitOuterKey && isSimpleYamlKey(stripNodeProperties(explicitOuterKey[1]))) {
      explicitOuterKeyIndent = indent;
      continue;
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

    const outerScalar = line.match(/^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (outerScalar && isBlockHeader(outerScalar[1])) {
      ignoredBlockIndent = indent;
      continue;
    }

    const actionSource = actionStepSource(line);
    if (!actionSource) continue;
    for (const match of actionSource.matchAll(/(?:^|[{,])\s*uses\s*:\s*([^,}\s]+)/g)) {
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

  it('restricts flow-step scanning to the structural steps sequence', () => {
    const workflow = 'build: { env: { uses: harmless-value@v4 }, steps: [{ run: echo ok }] }';
    expect(extractTargetedActionRefs(workflow)).toEqual([]);
    expectTargetedRefsImmutable(workflow, 'flow-job-env.yml');
  });

  it('ignores steps and uses examples inside quoted flow scalars', () => {
    const documentation = 'env: { DOC: "steps: [{ uses: actions/checkout@v4 }]" }';
    expect(extractTargetedActionRefs(documentation)).toEqual([]);
    expectTargetedRefsImmutable(documentation, 'quoted-flow-docs.yml');
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

  it('ignores uses-like action examples nested inside explicit-key block scalars', () => {
    const documentation = [
      'jobs:',
      '  demo:',
      '    steps:',
      '      - ? run',
      '        : |',
      '            Example configuration:',
      '            uses: >-',
      '              actions/checkout@v4',
      '      - run: echo safe',
    ].join('\n');
    expect(extractTargetedActionRefs(documentation)).toEqual([]);
    expectTargetedRefsImmutable(documentation, 'explicit-block-scalar-docs.yml');
  });

  it('ignores explicit-key block scalars with YAML node properties on the value', () => {
    const documentation = [
      'jobs:',
      '  demo:',
      '    steps:',
      '      - ? run',
      '        : &script |',
      '            Example configuration:',
      '            uses: >-',
      '              actions/checkout@v4',
      '      - run: echo safe',
    ].join('\n');
    expect(extractTargetedActionRefs(documentation)).toEqual([]);
    expectTargetedRefsImmutable(documentation, 'explicit-node-property-block-scalar-docs.yml');
  });

  it('ignores explicit-key block scalars with YAML node properties on the key', () => {
    const documentation = [
      'jobs:',
      '  demo:',
      '    steps:',
      '      - ? &command run',
      '        : |',
      '            Example configuration:',
      '            uses: >-',
      '              actions/checkout@v4',
      '      - run: echo safe',
    ].join('\n');
    expect(extractTargetedActionRefs(documentation)).toEqual([]);
    expectTargetedRefsImmutable(documentation, 'explicit-key-node-property-block-scalar-docs.yml');
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
