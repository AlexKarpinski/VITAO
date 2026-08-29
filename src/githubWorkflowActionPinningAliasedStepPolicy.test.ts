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
    const anchoredValues = [
      ...line.matchAll(/&([A-Za-z_][A-Za-z0-9_-]*)\s*\{([^}]*)\}/g),
      ...line.matchAll(/&([A-Za-z_][A-Za-z0-9_-]*)\s*\[\s*\{([^}]*)\}\s*\]/g),
    ];
    for (const anchor of anchoredValues) {
      const uses = anchor[2].match(/(?:^|,)\s*["']?uses["']?\s*:\s*["']?([^,"'}\s]+)["']?/);
      if (uses) anchors.set(anchor[1], uses[1]);
    }
  }
  return anchors;
};

const aliasesUsedAsSteps = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  const collectInlineStepsAliases = (value: string) => {
    const trimmed = value.trim().replace(/\s+#.*$/, '');
    if (/^\*[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) {
      names.add(trimmed.slice(1));
      return;
    }
    const sequence = trimmed.match(/^\[([\s\S]*)\]$/);
    if (!sequence) return;
    for (const item of sequence[1].split(',')) {
      const alias = item.trim().match(/^\*([A-Za-z_][A-Za-z0-9_-]*)$/);
      if (alias) names.add(alias[1]);
    }
  };

  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const steps = trimmed.match(/^["']?steps["']?\s*:\s*(.*)$/);
    if (steps) {
      stepsIndent = indent;
      collectInlineStepsAliases(steps[1]);
      continue;
    }

    if (stepsIndent === null) continue;
    if (indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }

    const blockAlias = trimmed.match(/^-\s*\*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:#.*)?$/);
    if (blockAlias) names.add(blockAlias[1]);
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

  it('rejects a mutable action sequence aliased as the complete steps value', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: &common [{ uses: actions/checkout@v4 }]',
      '    steps: *common',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(unsafe, 'unsafe-sequence.yml')).toThrow();
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

  it('accepts an immutable action sequence aliased as the complete steps value', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: &common [{ uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }]',
      '    steps: *common',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(safe, 'safe-sequence.yml')).not.toThrow();
  });

  it('ignores alias-like text inside run scalars', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { uses: actions/checkout@v4 } ]',
      '    steps:',
      '      - run: echo *checkout',
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
