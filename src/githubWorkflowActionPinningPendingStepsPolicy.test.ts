import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const structuralBracketDelta = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  let delta = 0;

  for (const char of line) {
    if (quote) {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '[') delta += 1;
    else if (char === ']') delta -= 1;
  }

  return delta;
};

const extractUsesFromFlowMapping = (line: string) => {
  const refs: string[] = [];
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  let curlyDepth = 0;
  let squareDepth = 0;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '{') { curlyDepth += 1; continue; }
    if (char === '}') { curlyDepth -= 1; continue; }
    if (char === '[') { squareDepth += 1; continue; }
    if (char === ']') { squareDepth -= 1; continue; }

    if ((index === 0 || /[\[{,]/.test(line[index - 1])) && /\s/.test(char)) continue;
    const rest = line.slice(index);
    const match = rest.match(/^(?:["']?uses["']?)\s*:\s*([^,}\]]+)/);
    if (match && curlyDepth >= 1 && squareDepth >= 0) {
      refs.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
      index += match[0].length - 1;
    }
  }

  return refs;
};

const collectDeferredStepsRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let pendingStepsIndent: number | null = null;
  let flowDepth = 0;
  let blockStepsIndent: number | null = null;
  let bareStepIndent: number | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const indent = indentOf(raw);

    if (flowDepth === 0 && /^steps\s*:\s*$/.test(trimmed)) {
      pendingStepsIndent = indent;
      blockStepsIndent = indent;
      bareStepIndent = null;
      continue;
    }

    if (blockStepsIndent !== null && trimmed && indent <= blockStepsIndent && !/^steps\s*:/.test(trimmed)) {
      blockStepsIndent = null;
      bareStepIndent = null;
    }

    if (blockStepsIndent !== null && /^-\s*$/.test(trimmed)) {
      bareStepIndent = indent;
      continue;
    }

    if (bareStepIndent !== null && trimmed && indent > bareStepIndent) {
      const continuation = trimmed.replace(/^(?:&[A-Za-z0-9_.-]+|![^\s]+)\s+/, '');
      if (continuation.startsWith('{')) refs.push(...extractUsesFromFlowMapping(continuation));
      bareStepIndent = null;
    }

    if (pendingStepsIndent !== null && flowDepth === 0) {
      if (!trimmed) continue;
      if (indent <= pendingStepsIndent) {
        pendingStepsIndent = null;
      } else if (trimmed.startsWith('[')) {
        flowDepth = structuralBracketDelta(raw);
        pendingStepsIndent = null;
        if (flowDepth <= 0) flowDepth = 1;
      }
    }

    if (flowDepth === 0) continue;

    refs.push(...extractUsesFromFlowMapping(raw));
    flowDepth += structuralBracketDelta(raw);
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

  it('ignores quoted brackets while tracking a deferred flow sequence', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', '  test:', '    steps:', '      [', '        { run: "echo ]]" },', `        { uses: actions/checkout@${sha} }`, '      ]'].join('\n');
    expect(collectDeferredStepsRefs(pinned)).toContain(`actions/checkout@${sha}`);
    expectDeferredStepsPinned(pinned, 'quoted-brackets.yml');

    const mutable = ['jobs:', '  test:', '    steps:', '      [', '        { run: "echo ]]" },', '        { uses: actions/checkout@v4 }', '      ]'].join('\n');
    expect(() => expectDeferredStepsPinned(mutable, 'quoted-brackets.yml')).toThrow();
  });

  it('enforces node-property flow mappings after a bare block step marker', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', '  test:', '    steps:', '      -', `        &checkout { uses: actions/checkout@${sha} }`].join('\n');
    expect(collectDeferredStepsRefs(pinned)).toContain(`actions/checkout@${sha}`);
    expectDeferredStepsPinned(pinned, 'bare-node-property.yml');

    const mutable = ['jobs:', '  test:', '    steps:', '      -', '        &checkout { uses: actions/checkout@v4 }'].join('\n');
    expect(() => expectDeferredStepsPinned(mutable, 'bare-node-property.yml')).toThrow();
  });
});
