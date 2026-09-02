import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const blockScalarHeader = /:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;
const nodeProperties = /^(?:(?:&[^\s{}]+|![^\s{}]+|!)\s*)+/;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const unquote = (raw: string) => {
  const value = stripYamlComment(raw).trim().replace(/[,}]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const splitTopLevelEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const collectDirectUses = (body: string, refs: string[]) => {
  for (const entry of splitTopLevelEntries(body)) {
    const match = entry.match(/^\s*(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/);
    if (match) refs.push(unquote(match[1]));
  }
};

const collectSplitNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;
  let pendingStepIndent: number | null = null;

  for (const rawLine of lines) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = stripYamlComment(rawLine);
    const trimmed = line.trim();

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (blockScalarHeader.test(line)) { blockScalarIndent = indent; pendingStepIndent = null; continue; }

    if (/^(?:"steps"|'steps'|steps)\s*:\s*$/.test(trimmed)) { stepsIndent = indent; pendingStepIndent = null; continue; }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) { stepsIndent = null; pendingStepIndent = null; continue; }

    if (pendingStepIndent !== null) {
      if (indent > pendingStepIndent) {
        const continuation = trimmed.replace(nodeProperties, '');
        const mapping = continuation.match(/^\{([\s\S]*)\}\s*$/);
        if (mapping) collectDirectUses(mapping[1], refs);
        pendingStepIndent = null;
        if (mapping) continue;
      } else {
        pendingStepIndent = null;
      }
    }

    if (/^-\s*(?:(?:&[^\s{}]+|![^\s{}]+|!)\s*)*$/.test(trimmed)) {
      pendingStepIndent = indent;
    }
  }
  return refs;
};

const expectImmutableSplitNodePropertyStepRefs = (workflow: string, source: string) => {
  for (const ref of collectSplitNodePropertyStepRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('split node-property step immutable-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableSplitNodePropertyStepRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('enforces a flow action mapping split from its node-property sequence head', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['steps:', '  - &checkout', `    { uses: actions/checkout@${sha} }`].join('\n');
    expect(collectSplitNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableSplitNodePropertyStepRefs(pinned, 'split-node-property-step.yml');

    const mutable = ['steps:', '  - &checkout', '    { uses: actions/checkout@v4 }'].join('\n');
    expect(() => expectImmutableSplitNodePropertyStepRefs(mutable, 'split-node-property-step.yml')).toThrow();
  });

  it('enforces node properties after a bare sequence marker', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['steps:', '  -', `    &checkout { uses: actions/checkout@${sha} }`].join('\n');
    expect(collectSplitNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableSplitNodePropertyStepRefs(pinned, 'bare-marker-node-property-step.yml');

    const mutable = ['steps:', '  -', '    !!map { uses: actions/checkout@v4 }'].join('\n');
    expect(() => expectImmutableSplitNodePropertyStepRefs(mutable, 'bare-marker-node-property-step.yml')).toThrow();
  });

  it('supports tags and ignores nested uses-like mappings', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['steps:', '  - !!map', `    { env: { uses: actions/cache@v4 }, uses: actions/checkout@${sha} }`].join('\n');
    expect(collectSplitNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
  });

  it('ignores property-bearing mappings outside steps and inside block scalars', () => {
    const safe = [
      'strategy:',
      '  matrix:',
      '    include:',
      '      - &case',
      '        { uses: actions/checkout@v4 }',
      'env:',
      '  DOC: |',
      '    steps:',
      '      - &example',
      '        { uses: actions/cache@v4 }',
    ].join('\n');
    expect(collectSplitNodePropertyStepRefs(safe)).toEqual([]);
  });
});
