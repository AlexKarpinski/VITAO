import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /@[0-9a-f]{40}$/i;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
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
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /(?:^|:\s*)[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const stripBlockScalarBodies = (workflow: string) => {
  const lines = workflow.split('\n');
  const visible: string[] = [];
  let scalarIndent: number | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const indent = indentOf(rawLine);
    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) {
        visible.push('');
        continue;
      }
      scalarIndent = null;
    }

    visible.push(rawLine);
    if (blockHeader.test(stripYamlComment(rawLine).trimEnd())) scalarIndent = indent;
  }

  return visible.join('\n');
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
      continue;
    }
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

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try {
      return JSON.parse(key);
    } catch {
      return key.slice(1, -1);
    }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const stripNodeProperties = (value: string) => {
  let rest = value.trimStart();
  while (rest) {
    const anchor = rest.match(/^&[^\s[\]{},]+\s*/);
    const aliasTag = rest.match(/^!(?:![^\s[\]{},]+|<[^>]+>|[^\s[\]{},]*)\s*/);
    const match = anchor ?? aliasTag;
    if (!match) break;
    rest = rest.slice(match[0].length).trimStart();
  }
  return rest;
};

const collectRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const rawLine of stripBlockScalarBodies(workflow).split('\n')) {
    const line = stripYamlComment(rawLine);
    const jobsMatch = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
    if (!jobsMatch || decodeKey(jobsMatch[1]) !== 'jobs') continue;
    const jobsValue = stripNodeProperties(jobsMatch[2]);
    if (!jobsValue.startsWith('{') || !jobsValue.endsWith('}')) continue;

    for (const jobEntry of splitTopLevel(jobsValue.slice(1, -1))) {
      const jobMatch = jobEntry.match(/^\s*(?:\?\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
      if (!jobMatch) continue;
      const jobValue = stripNodeProperties(jobMatch[1]);
      if (!jobValue.startsWith('{') || !jobValue.endsWith('}')) continue;
      for (const field of splitTopLevel(jobValue.slice(1, -1))) {
        const fieldMatch = field.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
        if (fieldMatch && decodeKey(fieldMatch[1]) === 'uses') refs.push(fieldMatch[2].trim().replace(/^['"]|['"]$/g, ''));
      }
    }
  }
  return refs;
};

const expectImmutableInlineJobRefs = (workflow: string, source: string) => {
  for (const ref of collectRefs(workflow)) {
    expect(ref, `${source}: reusable workflow ref must use a full commit SHA`).toMatch(immutableRef);
  }
};

describe('decorated inline jobs pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableInlineJobRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects mutable refs behind anchors and bare tags on the jobs value', () => {
    const unsafe = [
      'jobs: &all { call: { uses: owner/repo/.github/workflows/build.yml@main } }',
      'jobs: ! { call: { uses: owner/repo/.github/workflows/build.yml@main } }',
    ];
    for (const workflow of unsafe) expect(() => expectImmutableInlineJobRefs(workflow, 'unsafe.yml')).toThrow();
  });

  it('accepts immutable refs and ignores nested uses-like fields', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = `jobs: &all { call: { env: { uses: harmless-value@v4 }, uses: owner/repo/.github/workflows/build.yml@${sha} } }`;
    expectImmutableInlineJobRefs(safe, 'safe.yml');
  });

  it('ignores jobs-like text inside block scalar scripts', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: |',
      '          cat <<\'EOF\'',
      '          jobs: &all { call: { uses: owner/repo/.github/workflows/build.yml@main } }',
      '          EOF',
    ].join('\n');
    expectImmutableInlineJobRefs(safe, 'block-scalar.yml');
  });
});
