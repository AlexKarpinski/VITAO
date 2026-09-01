import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-f]{40}$/i;
const anchorName = '[A-Za-z0-9_-]+';

type Definition = { line: number; ref: string };
type AliasUse = { line: number; name: string };

const decodeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const splitEntries = (mapping: string) => {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
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
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      entries.push(mapping.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(mapping.slice(start).trim());
  return entries;
};

const directUsesRef = (mapping: string) => {
  for (const entry of splitEntries(mapping)) {
    const pair = entry.match(/^(.+?)\s*:\s*['"]?([^,"'}\s]+)['"]?\s*$/);
    if (!pair) continue;
    const rawKey = pair[1].replace(/^\?\s*/, '').replace(/^(?:(?:&[^\s]+|!![^\s]+|![^\s]*)\s+)*/, '');
    if (decodeKey(rawKey) === 'uses') return pair[2];
  }
  return null;
};

const collectDefinitions = (workflow: string) => {
  const definitions = new Map<string, Definition[]>();
  const lines = workflow.split('\n');
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line];
    if (raw.trimStart().startsWith('#')) continue;
    const anchor = raw.match(new RegExp(`&(${anchorName})\\s*\\{([\\s\\S]*)\\}`));
    if (!anchor) continue;
    const ref = directUsesRef(anchor[2]);
    if (!ref) continue;
    const values = definitions.get(anchor[1]) ?? [];
    values.push({ line, ref });
    definitions.set(anchor[1], values);
  }
  return definitions;
};

const collectStepAliases = (workflow: string) => {
  const aliases: AliasUse[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line];
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const steps = trimmed.match(/^["']?steps["']?\s*:\s*(.*)$/);
    if (steps) {
      stepsIndent = indent;
      for (const match of steps[1].matchAll(new RegExp(`\\*(${anchorName})`, 'g'))) aliases.push({ line, name: match[1] });
      continue;
    }
    if (stepsIndent === null) continue;
    if (indent <= stepsIndent) {
      stepsIndent = null;
      continue;
    }
    const alias = trimmed.match(new RegExp(`^-\\s*\\*(${anchorName})\\s*$`));
    if (alias) aliases.push({ line, name: alias[1] });
  }
  return aliases;
};

const expectAliasedEscapedKeysPinned = (workflow: string, source: string) => {
  const definitions = collectDefinitions(workflow);
  for (const alias of collectStepAliases(workflow)) {
    const candidates = definitions.get(alias.name) ?? [];
    const definition = [...candidates].reverse().find((candidate) => candidate.line <= alias.line);
    const ref = definition?.ref;
    if (!ref || ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: aliased action *${alias.name} must use an immutable SHA`).toMatch(immutableSha);
  }
};

describe('GitHub workflow aliased escaped uses-key pinning', () => {
  it('rejects an escaped quoted uses key in an aliased mutable action', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { "\\u0075ses": actions/checkout@v4 } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expect(() => expectAliasedEscapedKeysPinned(unsafe, 'escaped-key.yml')).toThrow();
  });

  it('accepts an escaped quoted uses key with an immutable action ref', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy:',
      '      matrix:',
      '        include: [ &checkout { "\\u0075ses": actions/checkout@0123456789abcdef0123456789abcdef01234567 } ]',
      '    steps: [*checkout]',
    ].join('\n');
    expectAliasedEscapedKeysPinned(safe, 'escaped-key-safe.yml');
  });

  it('enforces escaped aliased uses keys across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectAliasedEscapedKeysPinned(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
