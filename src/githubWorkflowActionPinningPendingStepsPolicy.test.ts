import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const collectDeferredStepsRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let pendingStepsIndent: number | null = null;
  let flowDepth = 0;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = indentOf(raw);

    if (flowDepth === 0 && /^steps\s*:\s*$/.test(trimmed)) {
      pendingStepsIndent = indent;
      continue;
    }

    if (pendingStepsIndent !== null && flowDepth === 0) {
      if (!trimmed) continue;
      if (indent <= pendingStepsIndent) {
        pendingStepsIndent = null;
      } else if (trimmed.startsWith('[')) {
        flowDepth = 1;
        pendingStepsIndent = null;
      }
    }

    if (flowDepth === 0) continue;

    for (const match of raw.matchAll(/(?:^|[\[{,])\s*(?:["']?uses["']?)\s*:\s*([^,}\]]+)/g)) {
      refs.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
    }

    for (const char of raw) {
      if (char === '[') flowDepth += 1;
      else if (char === ']') flowDepth -= 1;
    }
    if (flowDepth < 0) flowDepth = 0;
  }

  return refs;
};

const expectDeferredStepsPinned = (workflow: string, source: string) => {
  for (const ref of collectDeferredStepsRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('deferred steps flow-sequence immutable pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectDeferredStepsPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('enforces refs when a steps sequence begins on the following line', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', '  test:', '    steps:', '      [', `        { uses: actions/checkout@${sha} }`, '      ]'].join('\n');
    expect(collectDeferredStepsRefs(pinned)).toContain(`actions/checkout@${sha}`);
    expectDeferredStepsPinned(pinned, 'pinned.yml');

    const mutable = ['jobs:', '  test:', '    steps:', '      [', '        { uses: actions/checkout@v4 }', '      ]'].join('\n');
    expect(() => expectDeferredStepsPinned(mutable, 'mutable.yml')).toThrow();
  });
});
