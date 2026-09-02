import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const stripValueNodeProperties = (raw: string) => {
  let value = raw.trim();
  while (true) {
    const next = value.replace(/^(?:&[A-Za-z0-9_-]+|!![^\s]+|!<[^>]+>|![^\s]+)\s+/, '');
    if (next === value) return value;
    value = next.trimStart();
  }
};

const unquote = (raw: string) => {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const actionRefsFromBlockSteps = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  for (const raw of lines) {
    const line = stripYamlComment(raw);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = indentOf(raw);

    if (stepsIndent === null) {
      if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) stepsIndent = indent;
      continue;
    }

    if (indent <= stepsIndent) {
      stepsIndent = /^["']?steps["']?\s*:\s*$/.test(trimmed) ? indent : null;
      continue;
    }

    const uses = trimmed.match(/^-\s*["']?uses["']?\s*:\s*(.+)$/)
      ?? trimmed.match(/^["']?uses["']?\s*:\s*(.+)$/);
    if (!uses) continue;

    const ref = unquote(stripValueNodeProperties(uses[1]));
    if (ref) refs.push(ref);
  }

  return refs;
};

const expectImmutableExternalActions = (workflow: string, source: string) => {
  for (const ref of actionRefsFromBlockSteps(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('GitHub workflow uses-value node-property pinning policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableExternalActions(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('accepts an immutable ref after an anchor on the uses value', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expectImmutableExternalActions([
      'jobs:',
      '  build:',
      '    steps:',
      `      - uses: &checkout-ref actions/checkout@${sha}`,
    ].join('\n'), 'anchored-value.yml');
  });

  it('still rejects a mutable ref after an anchor on the uses value', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: &checkout-ref actions/checkout@v4',
    ].join('\n');
    expect(() => expectImmutableExternalActions(unsafe, 'anchored-value.yml')).toThrow();
  });

  it('strips multiple YAML node properties before validating the ref', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expectImmutableExternalActions([
      'jobs:',
      '  build:',
      '    steps:',
      `      - uses: !trusted &checkout-ref actions/checkout@${sha}`,
    ].join('\n'), 'decorated-value.yml');
  });
});
