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

const expectDecoratedStepUsesPinned = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (/^steps\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) stepsIndent = null;
    if (stepsIndent === null) continue;

    const match = trimmed.match(/^-\s+(?:[&!][^\s]+\s+)+uses\s*:\s*([^\s]+)\s*$/);
    if (!match) continue;

    const ref = match[1];
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
