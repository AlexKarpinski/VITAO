import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[,}]\s*$/, '').trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
};

const isEscaped = (body: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && body[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && (quote === "'" || !isEscaped(value, index))) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const splitTopLevelFlowEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let squareDepth = 0;
  let curlyDepth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) { if (char === quote && (quote === "'" || !isEscaped(body, index))) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '[') squareDepth += 1;
    else if (char === ']') squareDepth -= 1;
    else if (char === '{') curlyDepth += 1;
    else if (char === '}') curlyDepth -= 1;
    else if (char === ',' && squareDepth === 0 && curlyDepth === 0) { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const decodeMappingKey = (rawKey: string) => {
  const key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) { try { return JSON.parse(key); } catch { return key.slice(1, -1); } }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const collectDirectUses = (body: string, refs: string[]) => {
  for (const entry of splitTopLevelFlowEntries(body)) {
    const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
    if (mapping && decodeMappingKey(mapping[1]) === 'uses') refs.push(unquote(mapping[2]));
  }
};

const collectExplicitJobsWorkflowRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let explicitJobsIndent: number | null = null;
  let jobsValueIndent: number | null = null;
  let pendingFlowJobIndent: number | null = null;
  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine);
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (/^\?\s+(?:jobs|["']jobs["'])\s*$/.test(trimmed)) { explicitJobsIndent = indent; jobsValueIndent = null; pendingFlowJobIndent = null; continue; }
    if (explicitJobsIndent !== null && jobsValueIndent === null) {
      if (!trimmed) continue;
      if (indent < explicitJobsIndent || !/^:\s*$/.test(trimmed)) { explicitJobsIndent = null; continue; }
      jobsValueIndent = indent; continue;
    }
    if (jobsValueIndent === null || !trimmed) continue;
    if (indent <= jobsValueIndent) { explicitJobsIndent = null; jobsValueIndent = null; pendingFlowJobIndent = null; continue; }

    if (pendingFlowJobIndent !== null) {
      if (indent > pendingFlowJobIndent) {
        const continued = trimmed.match(/^\{([\s\S]*)\}\s*$/);
        if (continued) collectDirectUses(continued[1], refs);
      }
      pendingFlowJobIndent = null;
      if (/^\{/.test(trimmed)) continue;
    }

    const splitNodePropertyJob = trimmed.match(/^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:&[^\s{}]+|![^\s{}]+)(?:\s+(?:&[^\s{}]+|![^\s{}]+))*\s*$/);
    if (splitNodePropertyJob) {
      pendingFlowJobIndent = indent;
      continue;
    }

    const flowJob = trimmed.match(/^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:(?:&[^\s{}]+|![^\s{}]+)\s+)*\{([\s\S]*)\}\s*$/);
    if (flowJob) collectDirectUses(flowJob[1], refs);
  }
  return refs;
};

const expectImmutableExplicitJobsRefs = (workflow: string, source: string) => {
  for (const ref of collectExplicitJobsWorkflowRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('explicit top-level jobs immutable-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableExplicitJobsRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });
  it('enforces reusable-workflow pins below an explicit jobs key', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectImmutableExplicitJobsRefs(pinned, 'explicit-jobs.yml');
    const mutable = ['? jobs', ':', '  call: { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableExplicitJobsRefs(mutable, 'explicit-jobs.yml')).toThrow();
  });
  it('does not treat nested uses-like metadata as a reusable-workflow ref', () => {
    const safe = ['? jobs', ':', '  build: { runs-on: ubuntu-latest, env: { NOTE: ok, uses: actions/checkout@v4 }, with: { uses: actions/cache@v4 } }'].join('\n');
    expect(collectExplicitJobsWorkflowRefs(safe)).toEqual([]);
  });
  it('checks only a direct job-level uses key when nested mappings also contain uses-like keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: { env: { NOTE: ok, uses: actions/checkout@v4 }, uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
  });
  it('keeps parsing direct uses after a quoted scalar ending in an escaped backslash', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: { with: { note: "foo\\\\" }, uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
  });
  it('enforces explicit flow jobs with trailing YAML comments', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: { uses: owner/repo/.github/workflows/build.yml@${sha} } # pinned`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    const mutable = ['? jobs', ':', '  call: { uses: owner/repo/.github/workflows/build.yml@main } # mutable'].join('\n');
    expect(() => expectImmutableExplicitJobsRefs(mutable, 'explicit-jobs-comment.yml')).toThrow();
  });
  it('enforces reusable-workflow pins when a flow job has YAML node properties', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', `  call: &shared { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    const mutable = ['? jobs', ':', '  call: !shared { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableExplicitJobsRefs(mutable, 'explicit-jobs-node-property.yml')).toThrow();
  });
  it('tracks node properties whose flow mapping starts on the following line', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['? jobs', ':', '  call: &shared', `    { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectExplicitJobsWorkflowRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    const mutable = ['? jobs', ':', '  call: !shared', '    { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableExplicitJobsRefs(mutable, 'explicit-jobs-split-node-property.yml')).toThrow();
  });
});
