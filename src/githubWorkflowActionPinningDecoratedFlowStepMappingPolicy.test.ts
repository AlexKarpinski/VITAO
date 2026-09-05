import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) return line.slice(0, index);
  }
  return line;
};

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let curly = 0;
  let square = 0;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const decodeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const stripNodeProperties = (value: string) =>
  value
    .trim()
    .replace(/^(?:(?:&[^\s]+)|(?:!![^\s]+)|(?:!<[^>]+>)|(?:![^\s]*)|(?:![ ]?))\s*/g, '')
    .trim();

const collectDecoratedFlowStepRefs = (workflow: string) => {
  const refs: string[] = [];
  let stepsIndent: number | null = null;
  for (const rawLine of workflow.split('\n')) {
    const line = stripYamlComment(rawLine);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    const steps = trimmed.match(/^(?:"steps"|'steps'|steps)\s*:\s*$/);
    if (steps) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (stepsIndent === null) continue;

    const item = trimmed.match(/^-\s*(.*?)\s*(\{[\s\S]*\})\s*$/);
    if (!item) continue;
    const mapping = stripNodeProperties(item[2]);
    if (!mapping.startsWith('{') || !mapping.endsWith('}')) continue;
    for (const entry of splitTopLevel(mapping.slice(1, -1))) {
      const pair = entry.match(/^\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
      if (!pair || decodeKey(pair[1]) !== 'uses') continue;
      refs.push(pair[2].replace(/[,}]\s*$/, '').trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const expectImmutable = (workflow: string, source: string) => {
  for (const ref of collectDecoratedFlowStepRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('GitHub workflow decorated flow-step action pinning policy', () => {
  it('enforces decorated flow-step mappings in checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutable(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects an anchored flow step with a mutable action ref', () => {
    expect(() =>
      expectImmutable('steps:\n  - &checkout { uses: actions/checkout@v4 }', 'anchored.yml'),
    ).toThrow();
  });

  it('rejects a tagged flow step with a mutable action ref', () => {
    expect(() =>
      expectImmutable('steps:\n  - !!map { uses: actions/checkout@v4 }', 'tagged.yml'),
    ).toThrow();
  });

  it('accepts a decorated flow step pinned to a full commit SHA', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(() =>
      expectImmutable(`steps:\n  - &checkout { name: Checkout, uses: actions/checkout@${sha} }`, 'pinned.yml'),
    ).not.toThrow();
  });

  it('does not scan node-property mappings outside steps', () => {
    expect(() =>
      expectImmutable(
        'strategy:\n  matrix:\n    include:\n      - &case { uses: actions/checkout@v4, os: ubuntu-latest }\nsteps:\n  - { run: echo safe }',
        'matrix.yml',
      ),
    ).not.toThrow();
  });
});
