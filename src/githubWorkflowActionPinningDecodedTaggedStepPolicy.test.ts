import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key); } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const immutableRef = (ref: string) => {
  if (ref.startsWith('./') || ref.startsWith('docker://')) return true;
  return /@[0-9a-fA-F]{40}$/.test(ref);
};

const collectTaggedBlockStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let jobIndent: number | null = null;
  let stepsIndent: number | null = null;
  let scalarIndent: number | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = indentOf(raw);
    if (scalarIndent !== null) {
      if (!trimmed || indent > scalarIndent) continue;
      scalarIndent = null;
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/:\s*[|>](?:[+-]?[1-9]?|[1-9][+-]?)?\s*(?:#.*)?$/.test(raw)) {
      scalarIndent = indent;
      continue;
    }

    const keyMatch = trimmed.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    const decoded = keyMatch ? decodeKey(keyMatch[1]) : null;
    if (decoded === 'jobs') {
      jobsIndent = indent;
      jobIndent = null;
      stepsIndent = null;
      continue;
    }
    if (jobsIndent !== null && indent <= jobsIndent) {
      jobsIndent = null;
      jobIndent = null;
      stepsIndent = null;
    }
    if (jobsIndent !== null && jobIndent === null && indent > jobsIndent && /:\s*(?:#.*)?$/.test(trimmed)) {
      jobIndent = indent;
    }
    if (jobIndent !== null && indent < jobIndent) {
      jobIndent = null;
      stepsIndent = null;
    }
    if (jobsIndent !== null && jobIndent !== null && indent > jobIndent && decoded === 'steps') {
      stepsIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) {
      stepsIndent = null;
    }
    if (stepsIndent === null) continue;

    const taggedStep = trimmed.match(/^-\s+(?:(?:![^\s{]+|!<[^>]+>|!|&[^\s{]+)\s+)+\{([\s\S]*)\}\s*(?:#.*)?$/);
    if (!taggedStep) continue;
    const uses = taggedStep[1].match(/(?:^|,)\s*(?:"uses"|'uses'|uses)\s*:\s*([^,}\s]+)/);
    if (uses) refs.push(uses[1].replace(/^['"]|['"]$/g, ''));
  }
  return refs;
};

const expectPinnedTaggedBlockSteps = (workflow: string, source: string) => {
  for (const ref of collectTaggedBlockStepRefs(workflow)) {
    expect(immutableRef(ref), `${source}: tagged action step must use an immutable SHA: ${ref}`).toBe(true);
  }
};

describe('decoded steps tagged mapping pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedTaggedBlockSteps(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a tagged mapping under an escaped steps key', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    "\\u0073teps":',
      '      - !<tag:yaml.org,2002:map> { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectPinnedTaggedBlockSteps(unsafe, 'tagged.yml')).toThrow();
  });

  it('accepts an immutable tagged action reference', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    "\\u0073teps":',
      '      - !<tag:yaml.org,2002:map> { uses: actions/checkout@0123456789abcdef0123456789abcdef01234567 }',
    ].join('\n');
    expectPinnedTaggedBlockSteps(safe, 'tagged-safe.yml');
  });
});
