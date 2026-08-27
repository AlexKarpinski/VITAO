import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
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
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const splitTopLevel = (body: string) => {
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

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const collectCommentedNodePropertyRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let scalarIndent: number | null = null;

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine);
    const indent = indentOf(rawLine);
    const trimmed = line.trim();

    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }

    const scalar = line.match(/^\s*(?:[^:#]+|"(?:\\.|[^"\\])*"|'(?:''|[^'])*')\s*:\s*(.+?)\s*$/);
    if (scalar && scalarHeader.test(scalar[1].trim())) {
      scalarIndent = indent;
      continue;
    }

    if (/^steps\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent === null) continue;
    if (trimmed && indent <= stepsIndent) { stepsIndent = null; continue; }

    const step = trimmed.match(/^-\s+(?:[&!][^\s]+\s+)+\{([\s\S]*)\}\s*$/);
    if (!step) continue;
    for (const entry of splitTopLevel(step[1])) {
      const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
      if (!mapping || decodeKey(mapping[1]) !== 'uses') continue;
      const ref = mapping[2].trim().replace(/^['"]|['"]$/g, '');
      refs.push(ref);
    }
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectCommentedNodePropertyRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('commented node-property action pinning', () => {
  it('scans checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('enforces an anchored step even when the flow mapping has a trailing comment', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', '  build:', '    steps:', `      - &checkout { name: Checkout, uses: actions/checkout@${sha} } # pinned action`].join('\n');
    expect(collectCommentedNodePropertyRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableRefs(pinned, 'pinned.yml');

    const mutable = ['jobs:', '  build:', '    steps:', '      - &checkout { name: Checkout, uses: actions/checkout@v4 } # mutable action'].join('\n');
    expect(() => expectImmutableRefs(mutable, 'mutable.yml')).toThrow();
  });

  it('ignores node-property mappings outside steps scope', () => {
    const safe = ['jobs:', '  build:', '    strategy:', '      matrix:', '        include:', '          - &case { uses: actions/checkout@v4, os: ubuntu-latest }', '    steps:', '      - run: echo ok'].join('\n');
    expect(collectCommentedNodePropertyRefs(safe)).toEqual([]);
  });

  it('ignores node-property action examples inside block scalars', () => {
    const safe = ['jobs:', '  build:', '    env:', '      DOC: |', '        steps:', '          - &example { uses: actions/checkout@v4 } # documentation only', '    steps:', '      - run: echo ok'].join('\n');
    expect(collectCommentedNodePropertyRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'docs.yml');
  });
});
