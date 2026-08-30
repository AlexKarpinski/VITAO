import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === '"' && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const splitTopLevelFlowEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let square = 0;
  let curly = 0;
  let backslashes = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote === '"') {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === '"' && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === ',' && square === 0 && curly === 0) {
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
    try {
      return JSON.parse(key);
    } catch {
      return key.slice(1, -1);
    }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const unquote = (raw: string) => {
  const value = raw.trim().replace(/[,}]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const collectBareTaggedInlineJobRefs = (workflow: string) => {
  const refs: string[] = [];
  for (const rawLine of workflow.split('\n')) {
    const line = stripYamlComment(rawLine);
    const jobs = line.match(/^\s*(?:jobs|"jobs"|'jobs')\s*:\s*!\s*\{(.*)\}\s*$/);
    if (!jobs) continue;

    for (const jobEntry of splitTopLevelFlowEntries(jobs[1])) {
      const job = jobEntry.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\{([\s\S]*)\}\s*$/);
      if (!job) continue;
      for (const entry of splitTopLevelFlowEntries(job[1])) {
        const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
        if (mapping && decodeKey(mapping[1]) === 'uses') refs.push(unquote(mapping[2]));
      }
    }
  }
  return refs;
};

const expectImmutableExternalRefs = (workflow: string, source: string) => {
  for (const ref of collectBareTaggedInlineJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('GitHub action pinning for bare-tagged inline jobs', () => {
  it('enforces immutable refs when a bare tag decorates the inline jobs value', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expectImmutableExternalRefs(
      `jobs: ! { call: { uses: owner/repo/.github/workflows/build.yml@${sha} } }`,
      'pinned.yml',
    );
    expect(() =>
      expectImmutableExternalRefs(
        'jobs: ! { call: { uses: owner/repo/.github/workflows/build.yml@main } }',
        'mutable.yml',
      ),
    ).toThrow();
  });

  it('inspects only direct job fields', () => {
    expect(
      collectBareTaggedInlineJobRefs(
        'jobs: ! { build: { runs-on: ubuntu-latest, env: { uses: harmless-value@v4 }, steps: [{ run: echo ok }] } }',
      ),
    ).toEqual([]);
  });

  it('enforces the policy across every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectImmutableExternalRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
