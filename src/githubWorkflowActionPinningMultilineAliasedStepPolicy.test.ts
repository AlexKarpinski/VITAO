import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableSha = /^[^\s@]+@[0-9a-f]{40}$/i;
const anchorName = '[A-Za-z0-9_][A-Za-z0-9_-]*';

const collectAnchoredRefs = (workflow: string) => {
  const refs = new Map<string, string>();
  for (const raw of workflow.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (line.trimStart().startsWith('#')) continue;
    const pattern = new RegExp(`&(${anchorName})\\b[^{}]*\\{[^{}]*\\buses\\s*:\\s*["']?([^,"'}\\s]+)`, 'g');
    for (const match of line.matchAll(pattern)) refs.set(match[1], match[2]);
  }
  return refs;
};

const collectMultilineStepAliases = (workflow: string) => {
  const aliases = new Set<string>();
  const lines = workflow.split('\n');
  let inSteps = false;
  let depth = 0;

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!inSteps) {
      const steps = trimmed.match(/^["']?steps["']?\s*:\s*\[(.*)$/);
      if (!steps) continue;
      inSteps = true;
      depth = 1;
      const sameLine = steps[1];
      for (const match of sameLine.matchAll(new RegExp(`\\*(${anchorName})\\b`, 'g'))) aliases.add(match[1]);
      depth += (sameLine.match(/\[/g) ?? []).length - (sameLine.match(/\]/g) ?? []).length;
      if (depth <= 0) inSteps = false;
      continue;
    }

    for (const match of trimmed.matchAll(new RegExp(`(?:^|[,\\s])\\*(${anchorName})\\b`, 'g'))) aliases.add(match[1]);
    depth += (trimmed.match(/\[/g) ?? []).length - (trimmed.match(/\]/g) ?? []).length;
    if (depth <= 0) inSteps = false;
  }
  return aliases;
};

const expectMultilineAliasedStepsPinned = (workflow: string, source: string) => {
  const refs = collectAnchoredRefs(workflow);
  for (const alias of collectMultilineStepAliases(workflow)) {
    const ref = refs.get(alias);
    if (!ref || ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: multiline aliased step *${alias} must use an immutable SHA`).toMatch(immutableSha);
  }
};

describe('GitHub workflow multiline aliased-step pinning policy', () => {
  it('rejects a mutable alias item in a multiline steps sequence', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { uses: actions/checkout@v4 } ]',
      '    steps: [',
      '      *checkout',
      '    ]',
    ].join('\n');
    expect(() => expectMultilineAliasedStepsPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts an immutable alias item in a multiline steps sequence', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 } ]',
      '    steps: [',
      '      *checkout',
      '    ]',
    ].join('\n');
    expect(() => expectMultilineAliasedStepsPinned(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces multiline alias pins across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectMultilineAliasedStepsPinned(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
