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

const decodeYamlKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const structuralSquareDelta = (line: string) => {
  let quote: '"' | "'" | null = null;
  let delta = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        let backslashes = 0;
        for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') delta += 1;
    else if (char === ']') delta -= 1;
  }
  return delta;
};

const splitStructuralFlowEntries = (line: string) => {
  const entries: string[] = [];
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        let backslashes = 0;
        for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly <= 1 && square <= 1) {
      entries.push(line.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(line.slice(start));
  return entries;
};

const collectStructuralUses = (line: string) => {
  const refs: string[] = [];
  for (const entry of splitStructuralFlowEntries(line)) {
    const mapping = entry.match(/(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*([^,}\]]+)/);
    if (mapping && decodeYamlKey(mapping[1]) === 'uses') refs.push(stripQuoted(mapping[2]));
  }
  return refs;
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
    const directJob = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*([^,}]+)[,}]?/);
    if (directJob && decodeYamlKey(directJob[1]) === 'uses') refs.push(stripQuoted(directJob[2]));
  }
  return refs;
};

const extractBareSequenceStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  let bareDashIndent: number | null = null;
  let ignoredBlockIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (ignoredBlockIndent !== null) {
      if (!trimmed || indent > ignoredBlockIndent) continue;
      ignoredBlockIndent = null;
    }

    if (/:[ \t]*[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?[ \t]*$/.test(line)) {
      ignoredBlockIndent = indent;
      continue;
    }

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
      const uses = line.match(/^\s*\{?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*([^,}]+)[,}]?/);
      if (uses && decodeYamlKey(uses[1]) === 'uses') refs.push(stripQuoted(uses[2]));
    }
  }
  return refs;
};

const extractExplicitStepsRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let pendingSteps = false;
  let flowDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\?\s*["']?steps["']?\s*$/.test(trimmed)) {
      pendingSteps = true;
      continue;
    }
    if (pendingSteps) {
      const value = trimmed.match(/^:\s*(.*)$/);
      if (!value) {
        if (trimmed) pendingSteps = false;
        continue;
      }
      const opening = value[1].indexOf('[');
      if (opening >= 0) {
        const remainder = value[1].slice(opening + 1);
        refs.push(...collectStructuralUses(remainder));
        flowDepth = 1 + structuralSquareDelta(remainder);
      }
      pendingSteps = false;
      continue;
    }
    if (flowDepth > 0) {
      refs.push(...collectStructuralUses(line));
      flowDepth += structuralSquareDelta(line);
      if (flowDepth < 0) flowDepth = 0;
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
      expectPinned(extractExplicitStepsRefs(workflow));
    }
  });

  it('rejects mutable reusable-workflow refs in multiline outer jobs mappings', () => {
    const unsafe = ['jobs: {', '  call: { uses: owner/repo/.github/workflows/build.yml@main },', '}'].join('\n');
    expect(() => expectPinned(extractMultilineFlowJobRefs(unsafe))).toThrow();
  });

  it('rejects mutable action refs after a bare steps sequence marker', () => {
    const unsafe = ['jobs:', '  build:', '    steps:', '      -', '        { uses: actions/checkout@v4 }'].join('\n');
    expect(() => expectPinned(extractBareSequenceStepRefs(unsafe))).toThrow();
  });

  it('rejects escaped uses keys after a bare steps sequence marker', () => {
    const unsafe = ['jobs:', '  build:', '    steps:', '      -', '        { "\\u0075ses": actions/checkout@v4 }'].join('\n');
    expect(() => expectPinned(extractBareSequenceStepRefs(unsafe))).toThrow();
  });

  it('ignores bare-step examples inside block scalars', () => {
    const documented = ['env:', '  DOC: |', '    steps:', '      -', '        { uses: actions/checkout@v4 }'].join('\n');
    expect(extractBareSequenceStepRefs(documented)).toEqual([]);
    expectPinned(extractBareSequenceStepRefs(documented));
  });

  it('rejects mutable refs in multiline explicit-key steps sequences', () => {
    const unsafe = ['jobs:', '  build:', '    ? steps', '    : [', '      { uses: actions/checkout@v4 },', '    ]'].join('\n');
    expect(() => expectPinned(extractExplicitStepsRefs(unsafe))).toThrow();
  });

  it('keeps explicit steps context when quoted scalars contain closing brackets', () => {
    const unsafe = ['jobs:', '  build:', '    ? steps', '    : [', '      { run: "echo ]" },', '      { uses: actions/checkout@v4 },', '    ]'].join('\n');
    expect(() => expectPinned(extractExplicitStepsRefs(unsafe))).toThrow();
  });

  it('ignores uses-like text inside quoted explicit-step scalars', () => {
    const safe = ['jobs:', '  build:', '    ? steps', '    : [', '      { run: "echo ok, uses: actions/checkout@v4" },', '    ]'].join('\n');
    expect(extractExplicitStepsRefs(safe)).toEqual([]);
    expectPinned(extractExplicitStepsRefs(safe));
  });

  it('accepts immutable refs for the same structural forms', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'jobs: {',
      `  call: { "uses": owner/repo/.github/workflows/build.yml@${sha} },`,
      '}',
      'jobs:',
      '  build:',
      '    steps:',
      '      -',
      `        { "\\u0075ses": actions/checkout@${sha} }`,
      '    ? steps',
      '    : [',
      `      { uses: actions/setup-node@${sha} },`,
      '    ]',
    ].join('\n');
    expectPinned(extractMultilineFlowJobRefs(safe));
    expectPinned(extractBareSequenceStepRefs(safe));
    expectPinned(extractExplicitStepsRefs(safe));
  });
});
