import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let square = 0;
  let curly = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\' && quote === '"') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
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

const directUses = (body: string) => {
  for (const entry of splitTopLevel(body)) {
    const match = entry.match(/^\s*(?:"uses"|'uses'|uses)\s*:\s*(.+?)\s*$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectDecoratedFlowJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let directJobIndent: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = indentOf(line);

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      directJobIndent = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (indent <= jobsIndent) {
      jobsIndent = null;
      directJobIndent = null;
      continue;
    }

    const mappingKey = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (mappingKey && directJobIndent === null) directJobIndent = indent;
    if (directJobIndent === null || indent !== directJobIndent) continue;

    const job = line.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:(?:&[^\s]+|![^\s]+|!)\s*)+\{([\s\S]*)\}\s*$/);
    if (!job) continue;
    const ref = directUses(job[1]);
    if (ref) refs.push(ref);
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectDecoratedFlowJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('decorated flow job value action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable reusable workflow after an anchor on the job value', () => {
    const unsafe = ['jobs:', '  call: &shared { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'anchored-job.yml')).toThrow();
  });

  it('rejects a mutable reusable workflow after a tag on the job value', () => {
    const unsafe = ['jobs:', '  call: !!map { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'tagged-job.yml')).toThrow();
  });

  it('accepts immutable and local reusable workflows', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', `  remote: &shared { uses: owner/repo/.github/workflows/build.yml@${sha} }`, '  local: !!map { uses: ./.github/workflows/local.yml }'].join('\n');
    expectImmutableRefs(safe, 'safe.yml');
  });

  it('ignores decorated nested flow mappings inside an ordinary job', () => {
    const safe = ['jobs:', '  build:', '    runs-on: ubuntu-latest', '    env: &settings { uses: harmless-value@v4 }', '    steps:', '      - run: echo safe'].join('\n');
    expect(collectDecoratedFlowJobRefs(safe)).toEqual([]);
  });
});
