import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^(?:(?:![^\s]+|&[^\s]+)\s+)*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/;

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const quoteCloses = (text: string, quote: '"' | "'", start = 0) => {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== quote) continue;
    if (quote === "'") {
      if (text[index + 1] === "'") { index += 1; continue; }
      return true;
    }
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return true;
  }
  return false;
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

const structuralSquareDelta = (text: string) => {
  let delta = 0;
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\' && quote === '"') { backslashes += 1; continue; }
      if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") { index += 1; continue; }
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '[') delta += 1;
    else if (char === ']') delta -= 1;
  }
  return delta;
};

const refsFromTaggedSequence = (body: string) => {
  const refs: string[] = [];
  for (const stepEntry of splitTopLevel(body)) {
    const step = stepEntry.match(/^\s*\{([\s\S]*)\}\s*$/);
    if (!step) continue;
    for (const entry of splitTopLevel(step[1])) {
      const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
      if (!mapping || decodeKey(mapping[1]) !== 'uses') continue;
      refs.push(mapping[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const collectTaggedStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let pendingExplicitIndent: number | null = null;
  let multilineQuote: '"' | "'" | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (multilineQuote) {
      if (quoteCloses(line, multilineQuote)) multilineQuote = null;
      continue;
    }
    const scalarValue = line.match(/^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(["'])(.*)$/);
    if (scalarValue && !quoteCloses(scalarValue[2], scalarValue[1] as '"' | "'")) {
      multilineQuote = scalarValue[1] as '"' | "'";
      continue;
    }

    const explicitKey = line.match(/^(\s*)\?\s+(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*$/);
    if (explicitKey) {
      pendingExplicitIndent = explicitKey[1].length;
      continue;
    }
    if (pendingExplicitIndent !== null) {
      const explicitValue = line.match(/^(\s*):\s*(.+?)\s*$/);
      if (explicitValue && explicitValue[1].length === pendingExplicitIndent && blockHeader.test(explicitValue[2].trim())) {
        const parentIndent = pendingExplicitIndent;
        while (index + 1 < lines.length) {
          const next = lines[index + 1];
          if (next.trim() && indentOf(next) <= parentIndent) break;
          index += 1;
        }
        pendingExplicitIndent = null;
        continue;
      }
      if (line.trim() && indentOf(line) <= pendingExplicitIndent) pendingExplicitIndent = null;
    }

    const scalar = line.match(/^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (scalar && blockHeader.test(scalar[1].trim())) {
      const parentIndent = indentOf(line);
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() && indentOf(next) <= parentIndent) break;
        index += 1;
      }
      continue;
    }

    const taggedStart = line.match(/^\s*(?:["']?steps["']?)\s*:\s*(?:(?:![^\s]+|&[^\s]+)\s+)+\[([\s\S]*)$/);
    if (!taggedStart) continue;

    let body = taggedStart[1];
    let depth = 1 + structuralSquareDelta(body);
    while (depth > 0 && index + 1 < lines.length) {
      index += 1;
      const next = lines[index];
      body += `\n${next}`;
      depth += structuralSquareDelta(next);
    }
    if (depth !== 0) continue;

    let quote: '"' | "'" | null = null;
    let backslashes = 0;
    let closing = -1;
    for (let cursor = 0; cursor < body.length; cursor += 1) {
      const char = body[cursor];
      if (quote) {
        if (char === '\\' && quote === '"') { backslashes += 1; continue; }
        if (char === quote) {
          if (quote === "'" && body[cursor + 1] === "'") { cursor += 1; continue; }
          if (quote === "'" || backslashes % 2 === 0) quote = null;
        }
        backslashes = 0;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
      if (char === '[') depth += 1;
      else if (char === ']') {
        if (depth === 0) { closing = cursor; break; }
        depth -= 1;
      }
    }
    const sequenceBody = closing >= 0 ? body.slice(0, closing) : body.replace(/\]\s*$/, '');
    refs.push(...refsFromTaggedSequence(sequenceBody));
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

  it('rejects a mutable action in a multiline tagged steps sequence', () => {
    const unsafe = ['jobs:', '  build:', '    steps: !!seq [', '      { uses: actions/checkout@v4 }', '    ]'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'tagged-multiline.yml')).toThrow();
  });

  it('accepts an immutable action in a multiline tagged steps sequence', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  build:', '    steps: !!seq [', `      { uses: actions/checkout@${sha} }`, '    ]'].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableRefs(safe, 'tagged-multiline-pinned.yml');
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

  it('ignores tagged-step examples inside block scalars', () => {
    const safe = ['jobs:', '  build:', '    env:', '      DOC: |', '        steps: !!seq [{ uses: actions/checkout@v4 }]', '    steps:', '      - run: echo safe'].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'documentation.yml');
  });

  it('ignores tagged-step examples inside explicit-key block scalars', () => {
    const safe = ['jobs:', '  build:', '    env:', '      ? DOC', '      : |', '        steps: !!seq [{ uses: actions/checkout@v4 }]', '    steps:', '      - run: echo safe'].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'explicit-documentation.yml');
  });

  it('ignores tagged-step examples inside multiline quoted scalars', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    env:',
      '      DOC: "first line',
      '        steps: !!seq [{ uses: actions/checkout@v4 }]',
      '        final line"',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'quoted-documentation.yml');
  });

  it('ignores uses-like text outside tagged steps values', () => {
    const safe = ['jobs:', '  build:', '    env:', '      DOC: "uses: actions/checkout@v4"', '    steps:', '      - run: echo ok'].join('\n');
    expect(collectTaggedStepRefs(safe)).toEqual([]);
  });
});
