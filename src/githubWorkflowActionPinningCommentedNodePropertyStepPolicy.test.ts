import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const fullShaRef = /^[^\s@]+@[0-9a-f]{40}$/i;

const stripYamlComment = (value: string) => {
  let single = false;
  let double = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (single) {
      if (char === "'" && value[index + 1] === "'") index += 1;
      else if (char === "'") single = false;
      continue;
    }
    if (double) {
      if (char === '\\') index += 1;
      else if (char === '"') double = false;
      continue;
    }
    if (char === "'") single = true;
    else if (char === '"') double = true;
    else if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const collectCommentedNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;

  for (const raw of lines) {
    const uncommented = stripYamlComment(raw);
    const trimmed = uncommented.trim();
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (/^steps\s*:\s*$/.test(trimmed)) {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && trimmed && indent <= stepsIndent) stepsIndent = null;
    if (stepsIndent === null) continue;

    const step = trimmed.match(/^-\s+(?:&[^\s]+\s+|![^\s{]*\s+|!\s+)*\{([\s\S]*)\}$/);
    if (!step) continue;

    const uses = step[1].match(/(?:^|,)\s*uses\s*:\s*([^,}\s]+)\s*(?:,|$)/);
    if (uses) refs.push(uses[1].replace(/^['"]|['"]$/g, ''));
  }

  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectCommentedNodePropertyStepRefs(workflow)) {
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    expect(fullShaRef.test(ref), `${source}: mutable action ref ${ref}`).toBe(true);
  }
};

describe('GitHub workflow commented node-property step pinning policy', () => {
  it('rejects mutable action refs when a node-property step has a trailing comment', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { name: Checkout, uses: actions/checkout@v4 } # ordinary comment',
    ].join('\n');

    expect(() => expectPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts immutable refs and ignores comments outside steps', () => {
    const safe = [
      'env:',
      '  NOTE: "- &checkout { uses: actions/checkout@v4 } # documentation"',
      'jobs:',
      '  build:',
      '    steps:',
      '      - &checkout { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 } # pinned',
    ].join('\n');

    expectPinned(safe, 'safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
