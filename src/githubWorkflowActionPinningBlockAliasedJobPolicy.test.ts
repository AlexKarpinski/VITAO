import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const nodeProperties = /^(?:(?:&[^\s]+|![^\s]*|!![^\s]+)\s+)*/;

const stripYamlComment = (value: string) => {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === "'") {
      if (char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
};

const decodeKey = (raw: string) => {
  const stripped = raw.trim().replace(nodeProperties, '').trim();
  if (stripped.startsWith('"') && stripped.endsWith('"')) {
    try { return JSON.parse(stripped) as string; } catch { return stripped.slice(1, -1); }
  }
  if (stripped.startsWith("'") && stripped.endsWith("'")) return stripped.slice(1, -1).replace(/''/g, "'");
  return stripped;
};

const decodeRef = (raw: string) => stripYamlComment(raw).trim().replace(/^['"]|['"]$/g, '');

const collectBlockAnchoredJobRefs = (workflow: string) => {
  const lines = workflow.split('\n');
  const anchoredRefs = new Map<string, string>();

  for (let index = 0; index < lines.length; index += 1) {
    const anchorHead = lines[index].match(/^\s*(?:-\s*)?&([A-Za-z0-9_-]+)\s*$/);
    if (!anchorHead) continue;
    const parentIndent = indentOf(lines[index]);
    let pendingExplicitUses = false;
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim()) continue;
      if (indentOf(line) <= parentIndent) break;

      const explicitKey = line.match(/^\s*\?\s*(.+?)\s*$/);
      if (explicitKey) {
        pendingExplicitUses = decodeKey(explicitKey[1]) === 'uses';
        continue;
      }
      if (pendingExplicitUses) {
        const value = line.match(/^\s*:\s*(\S.*?)\s*$/);
        if (value) {
          anchoredRefs.set(anchorHead[1], decodeRef(value[1]));
          break;
        }
        pendingExplicitUses = false;
      }

      const direct = line.match(/^\s*(.+?)\s*:\s*(\S.*?)\s*$/);
      if (direct && decodeKey(direct[1]) === 'uses') {
        anchoredRefs.set(anchorHead[1], decodeRef(direct[2]));
        break;
      }
    }
  }

  const refs: string[] = [];
  let jobsIndent: number | null = null;
  let directJobIndent: number | null = null;
  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = indentOf(raw);
    if (/^\s*["']?jobs["']?\s*:\s*$/.test(raw)) {
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
    if (directJobIndent === null && /^\s*[^#][^:]*\s*:/.test(raw)) directJobIndent = indent;
    const alias = raw.match(/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\*([A-Za-z0-9_-]+)\s*$/);
    if (!alias || indent !== directJobIndent) continue;
    const ref = anchoredRefs.get(alias[1]);
    if (ref) refs.push(ref);
  }
  return refs;
};

const expectImmutableRefs = (workflow: string, source: string) => {
  for (const ref of collectBlockAnchoredJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('block-mapping aliased reusable-workflow pinning policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectImmutableRefs(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a mutable reusable workflow in an anchored block mapping', () => {
    const unsafe = [
      'templates:',
      '  - &call-job',
      '    ? !!str uses',
      '    : owner/repo/.github/workflows/build.yml@main',
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'block-aliased-job.yml')).toThrow();
  });

  it('accepts an immutable reusable workflow in an anchored block mapping', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'templates:',
      '  - &call-job',
      '    ? !!str uses',
      `    : owner/repo/.github/workflows/build.yml@${sha}`,
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expectImmutableRefs(safe, 'block-aliased-job-pinned.yml');
  });

  it('strips trailing YAML comments from aliased reusable workflow refs', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = [
      'templates:',
      '  - &call-job',
      '    ? !!str uses',
      `    : owner/repo/.github/workflows/build.yml@${sha} # pinned build workflow`,
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expectImmutableRefs(safe, 'block-aliased-job-commented.yml');
  });

  it('preserves hashes inside quoted reusable workflow refs', () => {
    const unsafe = [
      'templates:',
      '  - &call-job',
      "    uses: 'owner/repo/.github/workflows/build.yml@main#fragment'",
      'jobs:',
      '  call: *call-job',
    ].join('\n');
    expect(() => expectImmutableRefs(unsafe, 'block-aliased-job-quoted-hash.yml')).toThrow();
  });
});
