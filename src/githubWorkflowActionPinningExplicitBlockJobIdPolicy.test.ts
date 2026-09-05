import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const stripComment = (line: string) => {
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

const collectExplicitBlockJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let directJobIndent: number | null = null;
  let pendingExplicitJobIndent: number | null = null;
  let ignoredScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = indentOf(raw);
    const clean = stripComment(raw);
    const trimmed = clean.trim();

    if (ignoredScalarIndent !== null) {
      if (!trimmed || indent > ignoredScalarIndent) continue;
      ignoredScalarIndent = null;
    }
    if (!trimmed) continue;

    const scalarValue = clean.match(/:\s*(.+?)\s*$/)?.[1]?.trim();
    if (scalarValue && blockHeader.test(scalarValue)) {
      ignoredScalarIndent = indent;
      continue;
    }

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      directJobIndent = null;
      pendingExplicitJobIndent = null;
      continue;
    }
    if (jobsIndent !== null && indent <= jobsIndent) {
      jobsIndent = null;
      directJobIndent = null;
      pendingExplicitJobIndent = null;
    }
    if (jobsIndent === null) continue;

    if (directJobIndent === null && indent > jobsIndent) directJobIndent = indent;
    if (indent !== directJobIndent) continue;

    if (/^\?\s+.+$/.test(trimmed)) {
      pendingExplicitJobIndent = indent;
      continue;
    }

    if (pendingExplicitJobIndent !== null && indent === pendingExplicitJobIndent && /^:\s*\{/.test(trimmed)) {
      const body = trimmed.replace(/^:\s*\{/, '').replace(/\}\s*$/, '');
      let quote: '"' | "'" | null = null;
      let depth = 0;
      let start = 0;
      const entries: string[] = [];
      for (let cursor = 0; cursor <= body.length; cursor += 1) {
        const char = body[cursor];
        if (cursor === body.length) { entries.push(body.slice(start)); break; }
        if (quote) {
          if (char === quote && (quote === "'" || body[cursor - 1] !== '\\')) quote = null;
          continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === '{' || char === '[') depth += 1;
        else if (char === '}' || char === ']') depth -= 1;
        else if (char === ',' && depth === 0) { entries.push(body.slice(start, cursor)); start = cursor + 1; }
      }
      for (const entry of entries) {
        const match = entry.match(/^\s*["']?uses["']?\s*:\s*(.+?)\s*$/);
        if (match) refs.push(match[1].replace(/^['"]|['"]$/g, '').trim());
      }
      pendingExplicitJobIndent = null;
      continue;
    }

    pendingExplicitJobIndent = null;
  }
  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectExplicitBlockJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(immutableSha.test(ref), `${source}: reusable workflow ${ref} must use an immutable 40-character SHA`).toBe(true);
  }
};

describe('GitHub workflow explicit block job ID pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable reusable workflow under an explicit block job ID', () => {
    const workflow = ['jobs:', '  ? call', '  : { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectPinned(workflow, 'mutable.yml')).toThrow();
  });

  it('accepts an immutable reusable workflow under an explicit block job ID', () => {
    const workflow = ['jobs:', '  ? call', '  : { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }'].join('\n');
    expectPinned(workflow, 'pinned.yml');
  });

  it('accepts a local reusable workflow under an explicit block job ID', () => {
    const workflow = ['jobs:', '  ? call', '  : { uses: ./.github/workflows/reusable.yml }'].join('\n');
    expectPinned(workflow, 'local.yml');
  });

  it('ignores nested uses-like data under ordinary jobs', () => {
    const workflow = ['jobs:', '  build:', '    runs-on: ubuntu-latest', '    env: { uses: actions/checkout@v4 }', '    steps:', '      - run: echo safe'].join('\n');
    expectPinned(workflow, 'data.yml');
  });
});
