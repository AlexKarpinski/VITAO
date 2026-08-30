import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/i;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const nodeProperty = String.raw`(?:&[^\s\[\]{},]+|!(?:!|[^\s\[\]{},]*)?)`;
const nodePropertiesOnly = new RegExp(`^(?:${nodeProperty}\\s*)+$`);

const directUses = (mapping: string) => {
  const body = mapping.trim().replace(/^\{/, '').replace(/\}$/, '');
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;
  const entries: string[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  for (const entry of entries) {
    const match = entry.match(/^\s*["']?uses["']?\s*:\s*["']?([^,"'}\s]+)["']?\s*$/);
    if (match) return match[1];
  }
  return null;
};

const collectDeferredImplicitJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let pendingJobIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentOf(raw);

    if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      jobIndent = null;
      pendingJobIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      pendingJobIndent = null;
      continue;
    }

    if (pendingJobIndent !== null) {
      if (indent <= pendingJobIndent) {
        pendingJobIndent = null;
      } else if (nodePropertiesOnly.test(trimmed)) {
        continue;
      } else if (/^\{[\s\S]*\}\s*(?:#.*)?$/.test(trimmed)) {
        const clean = trimmed.replace(/\s+#.*$/, '');
        const ref = directUses(clean);
        if (ref) refs.push(ref);
        pendingJobIndent = null;
        continue;
      } else {
        pendingJobIndent = null;
      }
    }

    const jobKey = trimmed.match(new RegExp(`^(?:"(?:\\\\.|[^"\\\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\\s*:\\s*(?:${nodeProperty}\\s*)*$`));
    if (!jobKey) continue;
    if (jobIndent === null) jobIndent = indent;
    if (indent === jobIndent) pendingJobIndent = indent;
  }
  return refs;
};

const expectDeferredImplicitJobsPinned = (workflow: string, source: string) => {
  for (const ref of collectDeferredImplicitJobRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: deferred reusable-workflow job ${ref} must use an immutable SHA`).toMatch(immutableRef);
  }
};

describe('GitHub workflow deferred implicit-job action pinning policy', () => {
  it('rejects a mutable reusable workflow whose flow mapping starts on the next line', () => {
    const unsafe = [
      'jobs:',
      '  call:',
      '    { uses: owner/repo/.github/workflows/build.yml@main }',
    ].join('\n');
    expect(() => expectDeferredImplicitJobsPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts the same deferred job when pinned to a full SHA', () => {
    const safe = [
      'jobs:',
      '  call:',
      '    { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectDeferredImplicitJobsPinned(safe, 'safe.yml');
  });

  it('preserves a deferred job across value node-property lines', () => {
    const unsafe = [
      'jobs:',
      '  call: &job',
      '    !!map',
      '    { uses: owner/repo/.github/workflows/build.yml@main }',
    ].join('\n');
    expect(() => expectDeferredImplicitJobsPinned(unsafe, 'node-properties.yml')).toThrow();
  });

  it('accepts a property-decorated deferred job pinned to a full SHA', () => {
    const safe = [
      'jobs:',
      '  call: &job',
      '    !!map',
      '    { uses: owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectDeferredImplicitJobsPinned(safe, 'node-properties-safe.yml');
  });

  it('does not treat nested deferred mappings as direct reusable-workflow jobs', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    env:',
      '      CONFIG:',
      '        { uses: actions/checkout@v4 }',
      '    steps:',
      '      - run: echo ok',
    ].join('\n');
    expect(collectDeferredImplicitJobRefs(safe)).toEqual([]);
  });

  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectDeferredImplicitJobsPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
