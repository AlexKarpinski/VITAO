import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const splitTopLevelEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let square = 0;
  let curly = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === ',' && square === 0 && curly === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const directUsesRef = (body: string) => {
  for (const entry of splitTopLevelEntries(body)) {
    const match = entry.match(/^\s*(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/);
    if (match) return unquote(match[1]);
  }
  return null;
};

const collectNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (const rawLine of lines) {
    const withoutComment = stripYamlComment(rawLine);
    const trimmed = withoutComment.trim();
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }
    if (!trimmed) continue;

    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (/^(?:"steps"|'steps'|steps)\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }

    if (/^(?:-\s*)?(?:"run"|'run'|run)\s*:\s*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }

    if (stepsIndent === null || indent <= stepsIndent) continue;
    const decorated = trimmed.match(/^-\s+(?:(?:&[^\s{}\[\],]+|!(?:<[^>]+>|[^\s{}\[\],]*))\s+)+\{([\s\S]*)\}\s*$/);
    if (!decorated) continue;
    const ref = directUsesRef(decorated[1]);
    if (ref) refs.push(ref);
  }

  return refs;
};

const isImmutableActionRef = (ref: string) =>
  ref.startsWith('./')
  || ref.startsWith('docker://')
  || /@[0-9a-fA-F]{40}$/.test(ref);

const expectPinnedNodePropertySteps = (workflow: string, source: string) => {
  for (const ref of collectNodePropertyStepRefs(workflow)) {
    expect(isImmutableActionRef(ref), `${source}: action step must use an immutable 40-character SHA: ${ref}`).toBe(true);
  }
};

describe('action pinning for node-property flow step values', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedNodePropertySteps(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects mutable actions when a step mapping has an anchor', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectPinnedNodePropertySteps(workflow, 'mutable.yml')).toThrow();
  });

  it('accepts pinned actions when a step mapping has an anchor', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectPinnedNodePropertySteps(workflow, 'pinned.yml');
  });

  it('ignores node-property mappings outside executable steps', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include:',
      '          - &case { uses: arbitrary-data@v4 }',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectPinnedNodePropertySteps(workflow, 'matrix.yml');
  });
});
