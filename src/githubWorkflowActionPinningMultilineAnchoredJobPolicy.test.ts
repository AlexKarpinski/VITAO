import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[0-9a-f]{40}$/i;

const stripBlockScalarBodies = (workflow: string) => {
  const lines = workflow.split('\n');
  let scalarIndent: number | null = null;

  return lines
    .map((line) => {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (scalarIndent !== null) {
        if (line.trim() === '' || indent > scalarIndent) return ' '.repeat(line.length);
        scalarIndent = null;
      }

      const structural = line.replace(/\s+#.*$/, '');
      if (/^\s*(?:-\s+)?(?:[^:#]+|['"][^'"]+['"]):\s*(?:[&!][^\s]+\s*)*[|>][+-]?[1-9]?\s*$/.test(structural)) {
        scalarIndent = indent;
      }
      return line;
    })
    .join('\n');
};

const reusableRefFromMapping = (mapping: string) => {
  const implicit = mapping.match(/\buses\s*:\s*['"]?([^\s,'"}]+)['"]?/);
  if (implicit) return implicit[1];
  const explicit = mapping.match(/\?\s*(?:!!str\s+)?uses\s*\n\s*:\s*['"]?([^\s,'"}]+)['"]?/);
  return explicit?.[1] ?? null;
};

const collectAnchoredReusableJobs = (workflow: string) => {
  const structuralWorkflow = stripBlockScalarBodies(workflow);
  const anchors = new Map<string, string>();
  const starts = [...structuralWorkflow.matchAll(/&([A-Za-z0-9_-]+)\s*\{/g)];
  for (const start of starts) {
    const open = (start.index ?? 0) + start[0].lastIndexOf('{');
    let depth = 0;
    let quote: "'" | '"' | null = null;
    for (let index = open; index < structuralWorkflow.length; index += 1) {
      const char = structuralWorkflow[index];
      if (quote) {
        if (char === '\\' && quote === '"') {
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      if (char !== '}') continue;
      depth -= 1;
      if (depth !== 0) continue;
      const mapping = structuralWorkflow.slice(open + 1, index);
      const ref = reusableRefFromMapping(mapping);
      if (ref?.includes('/.github/workflows/')) anchors.set(start[1], ref);
      break;
    }
  }
  return anchors;
};

const expectPinnedAnchoredReusableJobs = (workflow: string, source: string) => {
  const anchors = collectAnchoredReusableJobs(workflow);
  const structuralWorkflow = stripBlockScalarBodies(workflow);
  for (const [anchor, reusable] of anchors) {
    const alias = new RegExp(`(?:^|\\n)\\s*[A-Za-z0-9_-]+\\s*:\\s*\\*${anchor}(?:\\s*(?:#.*)?)?(?:\\n|$)`);
    if (!alias.test(structuralWorkflow)) continue;
    const at = reusable.lastIndexOf('@');
    expect(at, `${source}: reusable workflow alias *${anchor} must use an immutable ref`).toBeGreaterThan(0);
    expect(
      immutableSha.test(reusable.slice(at + 1)),
      `${source}: reusable workflow alias *${anchor} must pin a 40-character SHA`,
    ).toBe(true);
  }
};

describe('multiline anchored reusable workflow job pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedAnchoredReusableJobs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable ref in a multiline anchored reusable job', () => {
    const unsafe = [
      'x-job: &call-job {',
      '  ? !!str uses',
      '  : owner/repo/.github/workflows/reusable.yml@main',
      '}',
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expect(() => expectPinnedAnchoredReusableJobs(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts an immutable ref in a multiline anchored reusable job', () => {
    const safe = [
      'x-job: &call-job {',
      '  ? !!str uses',
      '  : owner/repo/.github/workflows/reusable.yml@0123456789abcdef0123456789abcdef01234567',
      '}',
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expectPinnedAnchoredReusableJobs(safe, 'safe.yml');
  });

  it('ignores anchored reusable-job examples inside block scalars', () => {
    const documented = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      '          x-job: &call-job { uses: owner/repo/.github/workflows/reusable.yml@main }',
      '          call: *call-job',
    ].join('\n');
    expectPinnedAnchoredReusableJobs(documented, 'documented.yml');
  });
});
