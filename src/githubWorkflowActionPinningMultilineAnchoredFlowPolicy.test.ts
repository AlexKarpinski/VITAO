import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-f]{40}$/i;
const anchorName = '[A-Za-z0-9_-]+';

const isEscapedDoubleQuote = (value: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const maskQuotedScalars = (value: string) => {
  const chars = [...value];
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === 'single') {
      chars[index] = ' ';
      if (char === "'" && value[index + 1] === "'") {
        chars[index + 1] = ' ';
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      chars[index] = ' ';
      if (char === '"' && !isEscapedDoubleQuote(value, index)) quote = null;
      continue;
    }
    if (char === "'") {
      chars[index] = ' ';
      quote = 'single';
    } else if (char === '"') {
      chars[index] = ' ';
      quote = 'double';
    }
  }
  return chars.join('');
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
    else if (char === '}') {
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
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === '{') braces += 1;
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
    const explicit = entry.match(/^\?\s*(?:(?:&[A-Za-z0-9_-]+|!![^\s]+|![^\s]*)\s+)*["']?uses["']?\s*\n?\s*:\s*["']?([^,"'}\s]+)["']?\s*$/);
    if (explicit) return explicit[1];
    const canonical = entry.match(/^["']?uses["']?\s*:\s*["']?([^,"'}\s]+)["']?\s*$/);
    if (canonical) return canonical[1];
  }
  return null;
};

const collectMultilineAnchoredActionMappings = (workflow: string) => {
  const anchors = new Map<string, string>();
  const lines = workflow.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.trimStart().startsWith('#')) continue;
    const structuralLine = maskQuotedScalars(line);
    const pattern = new RegExp(`&(${anchorName})\\b`, 'g');
    for (const anchor of structuralLine.matchAll(pattern)) {
      const afterAnchor = anchor.index! + anchor[0].length;
      const brace = structuralLine.indexOf('{', afterAnchor);
      if (brace < 0) continue;
      let candidate = line;
      let mapping = extractBalancedFlowMapping(candidate, brace);
      for (let next = lineIndex + 1; mapping === null && next < lines.length; next += 1) {
        candidate += `\n${lines[next]}`;
        mapping = extractBalancedFlowMapping(candidate, brace);
      }
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
  for (const line of lines) {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const steps = trimmed.match(/^["']?steps["']?\s*:\s*(.*)$/);
    if (steps) {
      stepsIndent = indent;
      const value = steps[1].trim().replace(/\s+#.*$/, '');
      const sequence = value.match(/^\[([\s\S]*)\]$/);
      if (sequence) {
        for (const item of sequence[1].split(',')) {
          const alias = item.trim().match(new RegExp(`^\\*(${anchorName})$`));
          if (alias) names.add(alias[1]);
        }
      }
      continue;
    }
    if (stepsIndent === null) continue;
    if (indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }
    const alias = trimmed.match(new RegExp(`^-\\s*\\*(${anchorName})\\s*(?:#.*)?$`));
    if (alias) names.add(alias[1]);
  }
  return names;
};

const expectMultilineAliasedStepsPinned = (workflow: string, source: string) => {
  const anchors = collectMultilineAnchoredActionMappings(workflow);
  for (const alias of aliasesUsedAsSteps(workflow)) {
    const ref = anchors.get(alias);
    if (!ref || ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: multiline aliased action *${alias} must use an immutable SHA`).toMatch(immutableSha);
  }
};

describe('GitHub workflow multiline anchored flow action pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectMultilineAliasedStepsPinned(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });

  it('rejects a mutable action in a multiline anchored flow mapping', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout {',
      '          ? !!str uses',
      '          : actions/checkout@v4',
      '        } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expect(() => expectMultilineAliasedStepsPinned(unsafe, 'multiline-anchor.yml')).toThrow();
  });

  it('accepts an immutable action in a multiline anchored flow mapping', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout {',
      '          ? !!str uses',
      '          : actions/checkout@0123456789abcdef0123456789abcdef01234567',
      '        } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expect(() => expectMultilineAliasedStepsPinned(safe, 'multiline-anchor-safe.yml')).not.toThrow();
  });
});
