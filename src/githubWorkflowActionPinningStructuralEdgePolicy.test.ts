import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripQuoted = (value: string) => {
  const trimmed = value.trim().replace(/[},\]]+\s*$/, '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const extractMultilineFlowJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsFlowDepth = 0;
  let quote: '"' | "'" | null = null;

  const structuralDelta = (line: string) => {
    let delta = 0;
    quote = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quote) {
        if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') delta += 1;
      else if (char === '}') delta -= 1;
    }
    return delta;
  };

  for (const line of lines) {
    if (jobsFlowDepth === 0) {
      const start = line.match(/^\s*["']?jobs["']?\s*:\s*\{/);
      if (!start) continue;
      jobsFlowDepth = structuralDelta(line);
    } else {
      jobsFlowDepth += structuralDelta(line);
    }

    if (jobsFlowDepth <= 0) { jobsFlowDepth = 0; continue; }
    const directJob = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{\s*uses\s*:\s*([^,}]+)[,}]?/);
    if (directJob) refs.push(stripQuoted(directJob[1]));
  }
  return refs;
};

const extractBareSequenceStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let bareDashIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (stepsIndent === null) {
      if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) stepsIndent = indent;
      continue;
    }

    if (trimmed && indent <= stepsIndent) {
      stepsIndent = null;
      bareDashIndent = null;
      continue;
    }

    if (/^-\s*$/.test(trimmed) && indent > stepsIndent) {
      bareDashIndent = indent;
      continue;
    }

    if (bareDashIndent !== null) {
      if (trimmed && indent <= bareDashIndent) {
        bareDashIndent = null;
        continue;
      }
      const uses = line.match(/^\s*\{?\s*["']?uses["']?\s*:\s*([^,}]+)[,}]?/);
      if (uses) refs.push(stripQuoted(uses[1]));
    }
  }
  return refs;
};

const expectPinned = (refs: string[]) => {
  for (const ref of refs) expect(ref).toMatch(immutableRef);
};

describe('GitHub workflow structural action-pinning edge policy', () => {
  it('enforces structural edge cases across checked-in workflows', () => {
    for (const name of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, name), 'utf8');
      expectPinned(extractMultilineFlowJobRefs(workflow));
      expectPinned(extractBareSequenceStepRefs(workflow));
    }
  });

  it('rejects mutable reusable-workflow refs in multiline outer jobs mappings', () => {
    const unsafe = [
      'jobs: {',
      '  call: { uses: owner/repo/.github/workflows/build.yml@main },',
      '}',
    ].join('\n');
    expect(() => expectPinned(extractMultilineFlowJobRefs(unsafe))).toThrow();
  });

  it('rejects mutable action refs after a bare steps sequence marker', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      -',
      '        { uses: actions/checkout@v4 }',
    ].join('\n');
    expect(() => expectPinned(extractBareSequenceStepRefs(unsafe))).toThrow();
  });

  it('accepts immutable refs for the same structural forms', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'jobs: {',
      `  call: { uses: owner/repo/.github/workflows/build.yml@${sha} },`,
      '}',
      'jobs:',
      '  build:',
      '    steps:',
      '      -',
      `        { uses: actions/checkout@${sha} }`,
    ].join('\n');
    expectPinned(extractMultilineFlowJobRefs(safe));
    expectPinned(extractBareSequenceStepRefs(safe));
  });
});
