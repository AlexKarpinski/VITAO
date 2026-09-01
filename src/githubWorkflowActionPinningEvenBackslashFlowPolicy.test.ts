import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const quoteIsEscaped = (source: string, quoteIndex: number) => {
  let backslashes = 0;
  for (let index = quoteIndex - 1; index >= 0 && source[index] === '\\'; index -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const structuralSequence = (source: string, openingIndex: number) => {
  let quote: '"' | "'" | null = null;
  let depth = 0;
  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote === "'") {
      if (char === "'" && source[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"' && !quoteIsEscaped(source, index)) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(openingIndex, index + 1);
    }
  }
  return source.slice(openingIndex);
};

const collectFlowStepActionRefs = (workflow: string) => {
  const refs: string[] = [];
  const stepsPattern = /(?:^|[\n,{])\s*["']?steps["']?\s*:\s*\[/g;
  for (const match of workflow.matchAll(stepsPattern)) {
    if (match.index === undefined) continue;
    const openingIndex = workflow.indexOf('[', match.index);
    if (openingIndex < 0) continue;
    const sequence = structuralSequence(workflow, openingIndex);

    let quote: '"' | "'" | null = null;
    let square = 0;
    let curly = 0;
    let start = 1;
    const entries: string[] = [];
    for (let index = 1; index < sequence.length - 1; index += 1) {
      const char = sequence[index];
      if (quote === "'") {
        if (char === "'" && sequence[index + 1] === "'") {
          index += 1;
          continue;
        }
        if (char === "'") quote = null;
        continue;
      }
      if (quote === '"') {
        if (char === '"' && !quoteIsEscaped(sequence, index)) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '[') square += 1;
      else if (char === ']') square -= 1;
      else if (char === '{') curly += 1;
      else if (char === '}') curly -= 1;
      else if (char === ',' && square === 0 && curly === 0) {
        entries.push(sequence.slice(start, index));
        start = index + 1;
      }
    }
    entries.push(sequence.slice(start, -1));

    for (const entry of entries) {
      const mapping = entry.match(/(?:^|[{,])\s*["']?uses["']?\s*:\s*["']?([^\s,"'}\]]+)/);
      if (mapping) refs.push(mapping[1]);
    }
  }
  return refs;
};

const expectImmutableFlowStepActions = (workflow: string, source: string) => {
  for (const ref of collectFlowStepActionRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('flow action pinning after even backslashes', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableFlowStepActions(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('closes a double-quoted scalar after an even backslash run before checking the next step', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = String.raw`steps: [{ run: "printf \\\\" }, { uses: actions/checkout@${sha} }]`;
    expect(collectFlowStepActionRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectImmutableFlowStepActions(pinned, 'even-backslash.yml');

    const mutable = String.raw`steps: [{ run: "printf \\\\" }, { uses: actions/checkout@v4 }]`;
    expect(() => expectImmutableFlowStepActions(mutable, 'even-backslash.yml')).toThrow();
  });
});
