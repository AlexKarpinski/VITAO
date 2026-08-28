import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-f]{40}$/i;

const collectAnchoredActionMappings = (workflow: string) => {
  const anchors = new Map<string, string>();
  for (const line of workflow.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const anchor = line.match(/&([A-Za-z_][A-Za-z0-9_-]*)\s*\{([^}]*)\}/);
    if (!anchor) continue;
    const uses = anchor[2].match(/(?:^|,)\s*["']?uses["']?\s*:\s*["']?([^,"'}\s]+)["']?/);
    if (uses) anchors.set(anchor[1], uses[1]);
  }
  return anchors;
};

const aliasesUsedAsSteps = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (stepsIndent === null) {
      if (/^["']?steps["']?\s*:/.test(trimmed)) {
        stepsIndent = indent;
        for (const match of trimmed.matchAll(/\*([A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
      }
      continue;
    }
    if (indent <= stepsIndent && !trimmed.startsWith('-')) {
      stepsIndent = null;
      if (/^["']?steps["']?\s*:/.test(trimmed)) {
        stepsIndent = indent;
        for (const match of trimmed.matchAll(/\*([A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
      }
      continue;
    }
    for (const match of trimmed.matchAll(/\*([A-Za-z_][A-Za-z0-9_-]*)/g)) names.add(match[1]);
  }
  return names;
};

const expectAliasedStepsPinned = (workflow: string, source: string) => {
  const anchors = collectAnchoredActionMappings(workflow);
  for (const alias of aliasesUsedAsSteps(workflow)) {
    const ref = anchors.get(alias);
    if (!ref || ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: aliased action step *${alias} must use an immutable SHA`).toMatch(immutableSha);
  }
};

describe('GitHub workflow aliased action-step pinning policy', () => {
  it('rejects a mutable action mapping aliased into steps', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { uses: actions/checkout@v4 } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts an immutable action mapping aliased into steps', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 } ]',
      '    steps:',
      '      - *checkout',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces aliased action pins across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectAliasedStepsPinned(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
