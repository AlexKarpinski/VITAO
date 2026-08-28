import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let square = 0;
  let curly = 0;
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

const collectTaggedStepRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*(?:["']?steps["']?)\s*:\s*(?:(?:![^\s]+|&[^\s]+)\s+)+\[([\s\S]*)\]\s*$/);
    if (!match) continue;
    for (const stepEntry of splitTopLevel(match[1])) {
      const step = stepEntry.match(/^\s*\{([\s\S]*)\}\s*$/);
      if (!step) continue;
      for (const entry of splitTopLevel(step[1])) {
        const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
        if (!mapping || decodeKey(mapping[1]) !== 'uses') continue;
        refs.push(mapping[2].trim().replace(/^['"]|['"]$/g, ''));
      }
    }
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectTaggedStepRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('tagged steps action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable action in a standard tagged steps sequence', () => {
    const unsafe = ['jobs:', '  build:', '    steps: !!seq [{ uses: actions/checkout@v4 }]'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'tagged.yml')).toThrow();
  });

  it('accepts an immutable action in a standard tagged steps sequence', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  build:', `    steps: !!seq [{ uses: actions/checkout@${sha} }]`].join('\n');
    expectImmutableRefs(safe, 'tagged-pinned.yml');
  });

  it('supports anchors and tags before the sequence opener', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  build:', `    steps: &common !!seq [{ "uses": actions/checkout@${sha} }]`].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableRefs(safe, 'tagged-anchor.yml');
  });

  it('ignores uses-like text outside tagged steps values', () => {
    const safe = ['jobs:', '  build:', '    env:', '      DOC: "uses: actions/checkout@v4"', '    steps:', '      - run: echo ok'].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([]);
  });
});
