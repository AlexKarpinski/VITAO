import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/i;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\' && quote === '"') { backslashes += 1; continue; }
      if (char === quote) {
        if (quote === "'" && line[index + 1] === "'") { index += 1; continue; }
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
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

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let square = 0;
  let curly = 0;
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\' && quote === '"') { backslashes += 1; continue; }
      if (char === quote) {
        if (quote === "'" && body[index + 1] === "'") { index += 1; continue; }
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
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

const directUses = (mappingBody: string) => {
  for (const entry of splitTopLevel(mappingBody)) {
    const pair = entry.match(/^\s*["']?uses["']?\s*:\s*(.+?)\s*$/);
    if (pair) return pair[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectDeferredAnchoredStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let scalarIndent: number | null = null;
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let fieldIndent: number | null = null;
  let pendingStepsIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = indentOf(raw);
    const structural = stripComment(raw);
    const trimmed = structural.trim();

    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }
    if (!trimmed) continue;
    if (/^[^:]+:\s*(?:&[^\s]+\s+|!![^\s]+\s+|![^\s]*\s+)*[|>](?:[+-]?[1-9]?|[1-9][+-]?)?\s*$/.test(trimmed)) {
      scalarIndent = indent;
      continue;
    }

    if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = null;
      fieldIndent = null;
      pendingStepsIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      fieldIndent = null;
      pendingStepsIndent = null;
      continue;
    }

    if (jobIndent === null) {
      if (/^["']?[A-Za-z_][A-Za-z0-9_-]*["']?\s*:\s*/.test(trimmed)) jobIndent = indent;
      continue;
    }
    if (indent === jobIndent && /^["']?[A-Za-z_][A-Za-z0-9_-]*["']?\s*:\s*/.test(trimmed)) {
      fieldIndent = null;
      pendingStepsIndent = null;
      continue;
    }
    if (indent <= jobIndent) continue;
    if (fieldIndent === null) fieldIndent = indent;
    if (indent !== fieldIndent) continue;

    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) {
      pendingStepsIndent = indent;
      continue;
    }
    if (pendingStepsIndent === null) continue;

    const withoutProperties = trimmed.replace(/^(?:(?:&[^\s]+|!![^\s]+|![^\s]*)\s+)*/, '');
    if (!withoutProperties.startsWith('[')) {
      pendingStepsIndent = null;
      continue;
    }

    let sequence = withoutProperties;
    let depth = structuralSquareDelta(sequence);
    while (depth > 0 && index + 1 < lines.length) {
      index += 1;
      const next = stripComment(lines[index]);
      sequence += `\n${next}`;
      depth += structuralSquareDelta(next);
    }
    pendingStepsIndent = null;
    const body = sequence.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
    for (const entry of splitTopLevel(body)) {
      const step = entry.match(/^\s*\{([\s\S]*)\}\s*$/);
      if (!step) continue;
      const ref = directUses(step[1]);
      if (ref) refs.push(ref);
    }
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectDeferredAnchoredStepRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('deferred node-property steps action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable action after an anchored deferred steps value', () => {
    const unsafe = ['jobs:', '  build:', '    steps:', '      &common [', '        { uses: actions/checkout@v4 }', '      ]'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'deferred-anchor.yml')).toThrow();
  });

  it('accepts an immutable action after an anchored deferred steps value', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  build:', '    steps:', '      &common [', `        { uses: actions/checkout@${sha} }`, '      ]'].join('\n');
    expect(collectDeferredAnchoredStepRefs(safe)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableRefs(safe, 'deferred-anchor-safe.yml');
  });

  it('ignores nested uses-like mappings and block-scalar examples', () => {
    const safe = ['jobs:', '  build:', '    env:', '      DOC: |', '        steps:', '          &common [{ uses: actions/checkout@v4 }]', '    steps:', '      &real [{ run: echo ok, env: { uses: harmless@v4 } }]'].join('\n');
    expect(collectDeferredAnchoredStepRefs(safe)).toEqual([]);
    expectImmutableRefs(safe, 'deferred-anchor-doc.yml');
  });
});
