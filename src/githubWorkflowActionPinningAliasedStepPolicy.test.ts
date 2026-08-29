import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-f]{40}$/i;
const anchorName = '[A-Za-z0-9_][A-Za-z0-9_-]*';

const isEscapedDoubleQuote = (value: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const extractBalancedFlowMapping = (value: string, start: number) => {
  if (value[start] !== '{') return null;
  let depth = 0;
  let quote: 'single' | 'double' | null = null;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (quote === 'single') {
      if (char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '"' && !isEscapedDoubleQuote(value, index)) quote = null;
      continue;
    }
    if (char === "'") {
      quote = 'single';
      continue;
    }
    if (char === '"') {
      quote = 'double';
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start + 1, index);
    }
  }
  return null;
};

const splitTopLevelFlowEntries = (mapping: string) => {
  const entries: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < mapping.length; index += 1) {
    const char = mapping[index];
    if (quote === 'single') {
      if (char === "'" && mapping[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '"' && !isEscapedDoubleQuote(mapping, index)) quote = null;
      continue;
    }
    if (char === "'") {
      quote = 'single';
      continue;
    }
    if (char === '"') {
      quote = 'double';
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === ',' && braces === 0 && brackets === 0) {
      entries.push(mapping.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(mapping.slice(start).trim());
  return entries;
};

const directUsesRef = (mapping: string) => {
  for (const entry of splitTopLevelFlowEntries(mapping)) {
    const match = entry.match(/^["']?uses["']?\s*:\s*["']?([^,"'}\s]+)["']?\s*$/);
    if (match) return match[1];
  }
  return null;
};

const collectAnchoredActionMappings = (workflow: string) => {
  const anchors = new Map<string, string>();
  for (const line of workflow.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const anchorPattern = new RegExp(`&(${anchorName})\\b`, 'g');
    for (const anchor of line.matchAll(anchorPattern)) {
      const afterAnchor = anchor.index! + anchor[0].length;
      const remainder = line.slice(afterAnchor);
      const mappingOffset = remainder.search(/^(?:\s*\[)?\s*\{/);
      if (mappingOffset < 0) continue;
      const brace = line.indexOf('{', afterAnchor + mappingOffset);
      const mapping = extractBalancedFlowMapping(line, brace);
      if (mapping === null) continue;
      const uses = directUsesRef(mapping);
      if (uses) anchors.set(anchor[1], uses);
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
    const exactAlias = trimmed.match(new RegExp(`^\\*(${anchorName})$`));
    if (exactAlias) {
      names.add(exactAlias[1]);
      return;
    }
    const sequence = trimmed.match(/^\[([\s\S]*)\]$/);
    if (!sequence) return;
    for (const item of sequence[1].split(',')) {
      const alias = item.trim().match(new RegExp(`^\\*(${anchorName})$`));
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

    const blockAlias = trimmed.match(new RegExp(`^-\\s*\\*(${anchorName})\\s*(?:#.*)?$`));
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

  it('rejects a mutable direct uses after a nested mapping in an anchored step', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { with: { uses: owner/safe@0123456789abcdef0123456789abcdef01234567 }, uses: actions/checkout@v4 } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(unsafe, 'nested-mapping.yml')).toThrow();
  });

  it('rejects a mutable action mapping with a digit-leading alias name', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &1checkout { uses: actions/checkout@v4 } ]',
      '    steps: [*1checkout]',
    ].join('\n');
    expect(() => expectAliasedStepsPinned(unsafe, 'digit-leading-alias.yml')).toThrow();
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
