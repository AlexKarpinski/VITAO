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
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key.replace(/^\?\s*/, '').trim();
};

const directUses = (jobBody: string) => {
  for (const entry of splitTopLevel(jobBody)) {
    const mapping = entry.match(/^\s*((?:\?\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
    if (!mapping || decodeKey(mapping[1]) !== 'uses') continue;
    return mapping[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectExplicitInlineJobRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const rawLine of workflow.split('\n')) {
    const jobs = rawLine.match(/^\s*(?:"jobs"|'jobs'|jobs)\s*:\s*\{([\s\S]*)\}\s*$/);
    if (!jobs) continue;
    for (const entry of splitTopLevel(jobs[1])) {
      const explicitJob = entry.match(/^\s*\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*\{([\s\S]*)\}\s*$/);
      if (!explicitJob) continue;
      const ref = directUses(explicitJob[2]);
      if (ref) refs.push(ref);
    }
  }
  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectExplicitInlineJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('explicit inline jobs immutable-action policy', () => {
  it('scans checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects mutable reusable workflows behind explicit inline job keys', () => {
    const mutable = 'jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@main } }';
    expect(() => expectPinned(mutable, 'explicit-inline.yml')).toThrow();
  });

  it('accepts immutable reusable workflows behind explicit inline job keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = `jobs: { ? call : { uses: owner/repo/.github/workflows/build.yml@${sha} } }`;
    expect(collectExplicitInlineJobRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectPinned(pinned, 'pinned.yml');
  });

  it('ignores uses-like keys nested below the direct job mapping', () => {
    const safe = 'jobs: { ? call : { runs-on: ubuntu-latest, env: { uses: actions/checkout@v4 }, steps: [{ run: echo ok }] } }';
    expect(collectExplicitInlineJobRefs(safe)).toEqual([]);
    expectPinned(safe, 'safe.yml');
  });
});
