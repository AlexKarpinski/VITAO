import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

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
    else if (char === ',' && curly === 0 && square === 0) { entries.push(body.slice(start, index)); start = index + 1; }
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
  return key;
};

const directUses = (mappingBody: string) => {
  for (const entry of splitTopLevel(mappingBody)) {
    const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
    if (mapping && decodeKey(mapping[1]) === 'uses') return mapping[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
};

const collectBlockFlowJobRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let jobsIndent: number | null = null;
  let explicitJobKey: { indent: number; key: string } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const trimmed = line.trim();
    const indent = indentOf(raw);

    if (/^jobs\s*:\s*$/.test(trimmed)) {
      jobsIndent = indent;
      explicitJobKey = null;
      continue;
    }
    if (jobsIndent === null) continue;
    if (trimmed && indent <= jobsIndent) { jobsIndent = null; explicitJobKey = null; continue; }

    const explicitKey = trimmed.match(/^\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*$/);
    if (explicitKey) {
      explicitJobKey = { indent, key: decodeKey(explicitKey[1]) };
      continue;
    }
    if (explicitJobKey) {
      const explicitValue = trimmed.match(/^:\s*(?:(?:&|!)[^\s]+\s+)*\{([\s\S]*)\}\s*$/);
      if (indent === explicitJobKey.indent && explicitValue) {
        const ref = directUses(explicitValue[1]);
        if (ref) refs.push(ref);
        explicitJobKey = null;
        continue;
      }
      if (trimmed) explicitJobKey = null;
    }

    const implicitJob = trimmed.match(/^(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:(?:&|!)[^\s]+\s+)*\{([\s\S]*)\}\s*$/);
    if (!implicitJob) continue;
    const ref = directUses(implicitJob[1]);
    if (ref) refs.push(ref);
  }
  return refs;
};

const expectPinned = (workflow: string, source: string) => {
  for (const ref of collectBlockFlowJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `${source}: ${ref}`).toMatch(immutableRef);
  }
};

describe('block flow reusable-workflow job pinning', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectPinned(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('enforces node properties before a block flow job mapping', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', `  call: &shared { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectBlockFlowJobRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectPinned(pinned, 'pinned-node-property.yml');

    const mutable = ['jobs:', '  call: !shared { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectPinned(mutable, 'mutable-node-property.yml')).toThrow();
  });

  it('enforces block-style explicit job IDs', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const pinned = ['jobs:', '  ? call', `  : { uses: owner/repo/.github/workflows/build.yml@${sha} }`].join('\n');
    expect(collectBlockFlowJobRefs(pinned)).toEqual([`owner/repo/.github/workflows/build.yml@${sha}`]);
    expectPinned(pinned, 'pinned-explicit-job.yml');

    const mutable = ['jobs:', '  ? call', '  : &shared { uses: owner/repo/.github/workflows/build.yml@main }'].join('\n');
    expect(() => expectPinned(mutable, 'mutable-explicit-job.yml')).toThrow();
  });

  it('ignores uses-like keys nested below the direct job mapping', () => {
    const safe = ['jobs:', '  call: &shared { env: { uses: actions/checkout@v4 }, runs-on: ubuntu-latest }'].join('\n');
    expect(collectBlockFlowJobRefs(safe)).toEqual([]);
    expectPinned(safe, 'nested-env.yml');
  });
});
