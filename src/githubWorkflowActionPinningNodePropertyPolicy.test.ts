import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const unquote = (raw: string) => {
  const value = raw.trim().replace(/[,}]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const collectNodePropertyStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const entry = /^\s*-\s+(?:(?:&|!)[^\s{}]+\s+)+\{\s*(?:["']?uses["']?)\s*:\s*([^,}]+)[,}]?/gm;
  for (const match of workflow.matchAll(entry)) refs.push(unquote(match[1]));
  return refs;
};

const expectImmutableNodePropertyStepRefs = (workflow: string, source: string) => {
  for (const ref of collectNodePropertyStepRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('GitHub workflow node-property action pinning', () => {
  it('enforces node-property flow steps across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableNodePropertyStepRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects mutable refs after anchors or tags on a flow-style step', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `steps:\n  - &checkout { uses: actions/checkout@${sha} }`;
    expect(collectNodePropertyStepRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableNodePropertyStepRefs(pinned, 'anchored-step.yml');

    const mutable = 'steps:\n  - &checkout { uses: actions/checkout@v4 }';
    expect(() => expectImmutableNodePropertyStepRefs(mutable, 'anchored-step.yml')).toThrow();

    const tagged = 'steps:\n  - !custom { uses: actions/checkout@main }';
    expect(() => expectImmutableNodePropertyStepRefs(tagged, 'tagged-step.yml')).toThrow();
  });
});
