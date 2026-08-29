import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const immutableRef = /^[^\s@]+@[0-9a-f]{40}$/i;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const structuralDelta = (value: string) => {
  let quote: '"' | "'" | null = null;
  let delta = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') delta += 1;
    if (char === ']') delta -= 1;
  }
  return delta;
};

const refsFromSequenceLine = (line: string) => {
  const refs: string[] = [];
  const structural = stripYamlComment(line);
  const matcher = /(?:^|[,{[])\s*(?:["']?uses["']?)\s*:\s*([^,}\]]+)/g;
  for (const match of structural.matchAll(matcher)) {
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    refs.push(value);
  }
  return refs;
};

const collectDeferredTaggedStepRefs = (workflow: string) => {
  const lines = workflow.split('\n');
  const refs: string[] = [];
  let blockScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const indent = getIndent(rawLine);
    const line = stripYamlComment(rawLine);
    const trimmed = line.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (/^\s*(?:[^:#]+):\s*(?:[&!][^\s]+\s+)*[>|][1-9+-]*\s*$/.test(line)) {
      blockScalarIndent = indent;
      continue;
    }

    const tagged = line.match(/^(\s*)(?:["']?steps["']?)\s*:\s*(?:!![A-Za-z0-9_:/.-]+|![A-Za-z0-9_:/.-]+|!)\s*$/);
    if (!tagged) continue;
    const stepsIndent = tagged[1].length;

    let opener = index + 1;
    while (opener < lines.length && !stripYamlComment(lines[opener]).trim()) opener += 1;
    if (opener >= lines.length || getIndent(lines[opener]) <= stepsIndent) continue;
    const openerText = stripYamlComment(lines[opener]).trim();
    if (!openerText.startsWith('[')) continue;

    let depth = 0;
    for (let cursor = opener; cursor < lines.length; cursor += 1) {
      const sequenceLine = stripYamlComment(lines[cursor]);
      if (cursor > opener && sequenceLine.trim() && getIndent(lines[cursor]) <= stepsIndent) break;
      refs.push(...refsFromSequenceLine(sequenceLine));
      depth += structuralDelta(sequenceLine);
      if (depth <= 0) {
        index = cursor;
        break;
      }
    }
  }
  return refs;
};

const expectDeferredTaggedStepsPinned = (workflow: string) => {
  for (const ref of collectDeferredTaggedStepRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(immutableRef.test(ref), `mutable action reference in deferred tagged steps: ${ref}`).toBe(true);
  }
};

describe('GitHub action pinning for deferred tagged steps values', () => {
  it('enforces immutable refs in every checked-in workflow', () => {
    for (const name of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, name), 'utf8');
      expect(() => expectDeferredTaggedStepsPinned(workflow), name).not.toThrow();
    }
  });

  it('rejects a mutable action when a tagged steps sequence is deferred to the next line', () => {
    const unsafe = ['jobs:', '  build:', '    steps: !!seq', '      [', '        { uses: actions/checkout@v4 }', '      ]'].join('\n');
    expect(() => expectDeferredTaggedStepsPinned(unsafe)).toThrow();
  });

  it('accepts an immutable action in the same deferred tagged form', () => {
    const safe = ['jobs:', '  build:', '    steps: !!seq', '      [', '        { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }', '      ]'].join('\n');
    expect(() => expectDeferredTaggedStepsPinned(safe)).not.toThrow();
  });

  it('ignores tagged-step examples inside block-scalar documentation', () => {
    const safe = ['env:', '  DOC: |', '    steps: !!seq', '      [', '        { uses: actions/checkout@v4 }', '      ]'].join('\n');
    expect(() => expectDeferredTaggedStepsPinned(safe)).not.toThrow();
  });
});
