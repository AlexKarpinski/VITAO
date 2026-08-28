import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === ',' && curly === 0 && square === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const decodeKey = (raw: string) => {
  const trimmed = raw.trim().replace(/^\?\s*/, '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
};

const collectStepRefs = (sequenceBody: string) => {
  const refs: string[] = [];
  for (const step of splitTopLevel(sequenceBody)) {
    const mappingBody = step.trim().replace(/^\{/, '').replace(/\}$/, '');
    for (const entry of splitTopLevel(mappingBody)) {
      const mapping = entry.match(/^\s*((?:\?\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
      if (!mapping || decodeKey(mapping[1]) !== 'uses') continue;
      refs.push(mapping[2].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return refs;
};

const collectExplicitInlineStepsRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const rawLine of workflow.split('\n')) {
    const jobs = rawLine.match(/^\s*(?:"jobs"|'jobs'|jobs)\s*:\s*\{([\s\S]*)\}\s*$/);
    if (!jobs) continue;
    for (const jobEntry of splitTopLevel(jobs[1])) {
      const job = jobEntry.match(/^\s*(?:\?\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([\s\S]*)\}\s*$/);
      if (!job) continue;
      for (const entry of splitTopLevel(job[1])) {
        const mapping = entry.match(/^\s*\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\[([\s\S]*)\]\s*$/);
        if (!mapping || decodeKey(mapping[1]) !== 'steps') continue;
        refs.push(...collectStepRefs(mapping[2]));
      }
    }
  }
  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectExplicitInlineStepsRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('explicit inline steps immutable-action policy', () => {
  it('scans checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects mutable actions behind escaped explicit steps keys', () => {
    const mutable = 'jobs: { build: { ? "\\u0073teps" : [{ uses: actions/checkout@v4 }] } }';
    expect(() => expectPinned(mutable, 'explicit-inline-steps.yml')).toThrow();
  });

  it('accepts immutable actions behind explicit steps keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `jobs: { build: { ? steps : [{ uses: actions/checkout@${sha} }] } }`;
    expect(collectExplicitInlineStepsRefs(pinned)).toEqual([`actions/checkout@${sha}`]);
    expectPinned(pinned, 'pinned.yml');
  });

  it('ignores uses-like keys outside the explicit steps sequence', () => {
    const safe = 'jobs: { build: { env: { uses: actions/checkout@v4 }, ? steps : [{ run: echo ok }] } }';
    expect(collectExplicitInlineStepsRefs(safe)).toEqual([]);
    expectPinned(safe, 'safe.yml');
  });
});
