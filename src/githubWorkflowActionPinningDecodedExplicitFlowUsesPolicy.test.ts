import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

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

const quotedOrBareKey = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)`;

const collectExplicitFlowStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    const outer = line.match(new RegExp(`^\\s*(${quotedOrBareKey})\\s*:\\s*\\[([\\s\\S]*)\\]\\s*$`));
    if (!outer || decodeKey(outer[1]) !== 'steps') continue;

    const sequence = outer[2];
    const explicit = new RegExp(
      String.raw`(?:^|[,\{])\s*\?\s*(?:(?:!![A-Za-z0-9_:/.<>-]+|![^\s]+|!<[^>]+>|&[^\s]+)\s+)*(${quotedOrBareKey})\s*:\s*([^,}\]]+)`,
      'g',
    );
    for (let match = explicit.exec(sequence); match; match = explicit.exec(sequence)) {
      if (decodeKey(match[1]) !== 'uses') continue;
      refs.push(match[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const expectPinnedExplicitFlowSteps = (workflow: string, source: string) => {
  for (const ref of collectExplicitFlowStepRefs(workflow)) {
    expect(immutableRef(ref), `${source}: explicit flow action step must use an immutable SHA: ${ref}`).toBe(true);
  }
};

describe('decoded explicit flow-step action pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedExplicitFlowSteps(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects an escaped explicit uses key under an escaped steps key', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    "\\u0073teps": [{ ? !!str "\\u0075ses" : actions/checkout@v4 }]',
    ].join('\n');
    expect(() => expectPinnedExplicitFlowSteps(unsafe, 'explicit-flow.yml')).toThrow();
  });

  it('accepts an immutable ref behind the same explicit-key syntax', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    "\\u0073teps": [{ ? !!str "\\u0075ses" : actions/checkout@0123456789abcdef0123456789abcdef01234567 }]',
    ].join('\n');
    expectPinnedExplicitFlowSteps(safe, 'explicit-flow-safe.yml');
  });

  it('does not treat explicit uses-like data outside steps as an action', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    strategy: [{ ? !!str "\\u0075ses" : actions/checkout@v4 }]',
      '    steps:',
      '      - run: echo safe',
    ].join('\n');
    expectPinnedExplicitFlowSteps(safe, 'data-only.yml');
  });
});
