import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const stripComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let slashRun = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') { slashRun += 1; continue; }
      if (char === quote && (quote === "'" || slashRun % 2 === 0)) quote = null;
      slashRun = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; slashRun = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const unquote = (raw: string) => {
  const value = stripComment(raw).trim().replace(/[,}]\s*$/, '').trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const collectDirectBlockScalarKeyRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let ignoredScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const line = stripComment(raw);
    const trimmed = line.trim();

    if (ignoredScalarIndent !== null) {
      if (!trimmed || indent > ignoredScalarIndent) continue;
      ignoredScalarIndent = null;
    }
    if (!trimmed) continue;

    if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;

    const ordinaryScalar = line.match(/^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+)\s*:\s*([|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?)\s*$/);
    if (ordinaryScalar) { ignoredScalarIndent = indent; continue; }
    if (stepsIndent === null) continue;

    const explicitKeyHeader = trimmed.match(/^-\s*\?\s*([|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?)\s*$/);
    if (!explicitKeyHeader || !blockHeader.test(explicitKeyHeader[1])) continue;

    const keyBody: string[] = [];
    let valueIndex: number | null = null;
    let child = index + 1;
    for (; child < lines.length; child += 1) {
      const childRaw = lines[child];
      const childIndent = childRaw.match(/^\s*/)?.[0].length ?? 0;
      const childTrimmed = stripComment(childRaw).trim();
      if (!childTrimmed) continue;
      if (/^:\s*/.test(childTrimmed)) { valueIndex = child; break; }
      if (childIndent <= indent) break;
      keyBody.push(childTrimmed);
    }
    if (keyBody.join(' ').trim() !== 'uses') continue;

    for (let valueLine = valueIndex ?? child; valueLine < lines.length; valueLine += 1) {
      const valueRaw = lines[valueLine];
      const valueTrimmed = stripComment(valueRaw).trim();
      if (!valueTrimmed) continue;
      const value = valueTrimmed.match(/^:\s*(.+?)\s*$/);
      if (value) {
        refs.push(unquote(value[1]));
        index = valueLine;
      }
      break;
    }
  }
  return refs;
};

const expectImmutable = (workflow: string, source: string) => {
  for (const ref of collectDirectBlockScalarKeyRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('GitHub workflow direct block-scalar action-key pinning', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutable(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects mutable refs behind a block-scalar explicit uses key', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - ? |-',
      '          uses',
      '        : actions/checkout@v4',
    ].join('\n');
    expect(collectDirectBlockScalarKeyRefs(unsafe)).toEqual(['actions/checkout@v4']);
    expect(() => expectImmutable(unsafe, 'block-key.yml')).toThrow();
  });

  it('accepts immutable and local refs behind the same key form', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = [
      'steps:',
      '  - ? >-',
      '      uses',
      `    : actions/checkout@${sha}`,
    ].join('\n');
    const local = ['steps:', '  - ? |-', '      uses', '    : ./.github/actions/local'].join('\n');
    expectImmutable(pinned, 'pinned.yml');
    expectImmutable(local, 'local.yml');
  });

  it('does not treat block-scalar run documentation as action structure', () => {
    const safe = [
      'steps:',
      '  - run: |',
      '      - ? |-',
      '          uses',
      '        : actions/checkout@v4',
    ].join('\n');
    expect(collectDirectBlockScalarKeyRefs(safe)).toEqual([]);
  });
});
