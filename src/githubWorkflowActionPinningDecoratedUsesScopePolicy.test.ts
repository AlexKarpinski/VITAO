import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[0-9a-f]{40}$/i;

const stripComment = (line: string) => {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (single) {
      if (char === "'" && line[i + 1] === "'") {
        i += 1;
      } else if (char === "'") {
        single = false;
      }
      continue;
    }
    if (double) {
      if (char === '\\') {
        i += 1;
      } else if (char === '"') {
        double = false;
      }
      continue;
    }
    if (char === "'") single = true;
    else if (char === '"') double = true;
    else if (char === '#') return line.slice(0, i);
  }
  return line;
};

const decodeSimpleKey = (token: string) => {
  const trimmed = token.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const mappingKey = (trimmed: string) => {
  const match = trimmed.match(/^((?:"(?:\\.|[^"])*")|(?:'(?:''|[^'])*')|(?:[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
  return match ? decodeSimpleKey(match[1]) : null;
};

const isBlockScalarHeader = (trimmed: string) =>
  /^(?:-\s+)?[^:]+:\s*(?:(?:&[^\s]+|![^\s]*)\s+)*(?:[>|](?:[+-]?\d*|\d+[+-]?))\s*$/.test(trimmed);

const hasClosingDoubleQuote = (value: string) => {
  if (!value.startsWith('"')) return true;
  let backslashes = 0;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      backslashes += 1;
      continue;
    }
    if (char === '"' && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
};

const decodeDecoratedRef = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
};

const expectDecoratedStepUsesPinned = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let blockScalarIndent: number | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    if (mappingKey(trimmed) === 'steps') {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (stepsIndent === null) continue;

    if (isBlockScalarHeader(trimmed)) {
      blockScalarIndent = indent;
      continue;
    }

    const match = trimmed.match(/^-\s+(?:(?:&[^\s]+|![^\s]*)\s+)+(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/);
    if (!match) continue;

    let rawRef = match[1].trim();
    if (rawRef.startsWith('"') && !hasClosingDoubleQuote(rawRef)) {
      while (lineIndex + 1 < lines.length) {
        lineIndex += 1;
        const continuation = stripComment(lines[lineIndex]).trim();
        const joinsWithoutSpace = rawRef.endsWith('\\');
        if (joinsWithoutSpace) rawRef = rawRef.slice(0, -1);
        rawRef += joinsWithoutSpace ? continuation : ` ${continuation}`;
        if (hasClosingDoubleQuote(rawRef)) break;
      }
    }

    const ref = decodeDecoratedRef(rawRef);
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    const at = ref.lastIndexOf('@');
    expect(at).toBeGreaterThan(0);
    expect(immutableSha.test(ref.slice(at + 1)), `${source}: mutable decorated action ref ${ref}`).toBe(true);
  }
};

describe('GitHub workflow decorated uses scope policy', () => {
  it('rejects a mutable decorated uses key in block steps', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses: actions/checkout@v4',
    ].join('\n');

    expect(() => expectDecoratedStepUsesPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects a mutable quoted decorated uses key in block steps', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key "uses": actions/checkout@v4',
    ].join('\n');

    expect(() => expectDecoratedStepUsesPinned(unsafe, 'quoted-uses.yml')).toThrow();
  });

  it('accepts an immutable quoted decorated uses key in block steps', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      "      - &uses-key 'uses': actions/checkout@0123456789abcdef0123456789abcdef01234567",
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'quoted-uses-pinned.yml');
  });

  it('rejects a mutable uses key with a bare non-specific tag', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - ! uses: actions/checkout@v4',
    ].join('\n');

    expect(() => expectDecoratedStepUsesPinned(unsafe, 'bare-tag.yml')).toThrow();
  });

  it('accepts an immutable uses key with a bare non-specific tag', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - ! uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'bare-tag-pinned.yml');
  });

  it('rejects a mutable decorated uses key under a quoted steps key', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    "steps":',
      '      - &uses-key uses: actions/checkout@v4',
    ].join('\n');

    expect(() => expectDecoratedStepUsesPinned(unsafe, 'quoted-steps.yml')).toThrow();
  });

  it('accepts an immutable decorated action under a quoted steps key', () => {
    const safe = [
      'jobs:',
      '  build:',
      "    'steps':",
      '      - &uses-key uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'quoted-steps-pinned.yml');
  });

  it('accepts an immutable decorated action split across a quoted continuation', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses: "actions/check\\',
      '        out@0123456789abcdef0123456789abcdef01234567"',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'continued-ref.yml');
  });

  it('rejects a mutable decorated action split across a quoted continuation', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses: "actions/check\\',
      '        out@v4"',
    ].join('\n');

    expect(() => expectDecoratedStepUsesPinned(unsafe, 'continued-mutable-ref.yml')).toThrow();
  });

  it('ignores decorated uses examples inside YAML comments', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: echo safe',
      '    # steps: [{ &uses-key uses: actions/checkout@v4 }]',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'safe.yml');
  });

  it('ignores decorated uses examples inside run block scalars', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - run: |',
      '          echo "example:"',
      '          - &uses-key uses: actions/checkout@v4',
      '      - run: echo safe',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'block-scalar.yml');
  });

  it('accepts a full immutable SHA for decorated action keys', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &uses-key uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
    ].join('\n');

    expectDecoratedStepUsesPinned(safe, 'pinned.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectDecoratedStepUsesPinned(workflow, workflowFile);
    }
  });
});
