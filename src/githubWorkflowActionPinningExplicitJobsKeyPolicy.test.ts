import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[0-9a-f]{40}$/i;
const externalReusable = /^([^\s@]+\/.+?\.github\/workflows\/[^\s@]+)@([^\s#]+)$/;
const blockScalarHeader = /[>|](?:[+-]?[1-9]|[1-9]?[+-])?$/;
const nodeProperty = String.raw`(?:&[^\s,\[\]{}]+|!(?:<[^>]+>|[^\s,\[\]{}]*)?)`;

const decodeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const stripComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === '"' && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") { index += 1; continue; }
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const collectExplicitJobsReusableRefs = (workflow: string) => {
  const lines = workflow.split('\n');
  const refs: string[] = [];
  let blockScalarIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const keyLine = stripComment(lines[index]);
    const trimmed = keyLine.trim();
    const indent = keyLine.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndent !== null) {
      if (!trimmed || indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    if (/:[ \t]*/.test(keyLine) && blockScalarHeader.test(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }

    const explicit = keyLine.match(/^(\s*)\?\s*(.+?)\s*$/);
    if (!explicit || decodeKey(explicit[2]) !== 'jobs') continue;

    const keyIndent = explicit[1].length;
    let valueLine = index + 1;
    while (valueLine < lines.length && !stripComment(lines[valueLine]).trim()) valueLine += 1;
    if (valueLine >= lines.length) continue;

    const value = stripComment(lines[valueLine]).match(/^(\s*):\s*(.*)$/);
    if (!value || value[1].length < keyIndent) continue;
    const valueIndent = value[1].length;
    const usesKey = new RegExp(`^\\s*(?:${nodeProperty}\\s+)*(?:['\"]?uses['\"]?)\\s*:\\s*([^\\s#]+|\"[^\"]+\"|'[^']+')\\s*$`);

    for (let child = valueLine + 1; child < lines.length; child += 1) {
      const raw = stripComment(lines[child]);
      const childTrimmed = raw.trim();
      if (!childTrimmed) continue;
      const childIndent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (childIndent <= valueIndent) break;

      const uses = raw.match(usesKey);
      if (!uses) continue;
      const ref = uses[1].replace(/^['"]|['"]$/g, '');
      if (externalReusable.test(ref)) refs.push(ref);
    }
  }

  return refs;
};

const assertExplicitJobsPinned = (workflow: string) => {
  for (const ref of collectExplicitJobsReusableRefs(workflow)) {
    const match = ref.match(externalReusable);
    expect(match, `expected a reusable-workflow ref: ${ref}`).not.toBeNull();
    expect(match?.[2], `reusable workflow must use an immutable SHA: ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub workflow explicit jobs key pinning policy', () => {
  it('rejects mutable reusable refs under an explicit jobs key', () => {
    const workflow = `
on: workflow_dispatch
? jobs
:
  call:
    uses: owner/repo/.github/workflows/reusable.yml@main
`;
    expect(() => assertExplicitJobsPinned(workflow)).toThrow();
  });

  it('accepts immutable reusable refs under an explicit jobs key', () => {
    const workflow = `
on: workflow_dispatch
? jobs
:
  call:
    uses: owner/repo/.github/workflows/reusable.yml@0123456789abcdef0123456789abcdef01234567
`;
    expect(() => assertExplicitJobsPinned(workflow)).not.toThrow();
  });

  it('rejects mutable reusable refs with decorated uses keys under explicit jobs', () => {
    const workflow = `
on: workflow_dispatch
? jobs
:
  call:
    ! uses: owner/repo/.github/workflows/reusable.yml@main
`;
    expect(() => assertExplicitJobsPinned(workflow)).toThrow();
  });

  it('accepts immutable reusable refs with decorated uses keys under explicit jobs', () => {
    const workflow = `
on: workflow_dispatch
? jobs
:
  call:
    !!str uses: owner/repo/.github/workflows/reusable.yml@0123456789abcdef0123456789abcdef01234567
`;
    expect(() => assertExplicitJobsPinned(workflow)).not.toThrow();
  });

  it('does not treat explicit non-jobs mappings as workflow jobs', () => {
    const workflow = `
on: workflow_dispatch
? metadata
:
  call:
    uses: owner/repo/.github/workflows/reusable.yml@main
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo safe
`;
    expect(() => assertExplicitJobsPinned(workflow)).not.toThrow();
  });

  it('ignores explicit jobs text inside block scalar values', () => {
    const workflow = `
on: workflow_dispatch
env:
  DOC: |
    ? jobs
    :
      call:
        uses: owner/repo/.github/workflows/reusable.yml@main
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo safe
`;
    expect(() => assertExplicitJobsPinned(workflow)).not.toThrow();
  });

  it('enforces explicit jobs refs across checked-in workflows', () => {
    for (const file of workflowFiles) {
      assertExplicitJobsPinned(readFileSync(join(workflowsDir, file), 'utf8'));
    }
  });
});
