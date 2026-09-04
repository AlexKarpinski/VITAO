import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const yamlDoubleQuotedToJson = (key: string) => key
  .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => `\\u00${hex}`)
  .replace(/\\U([0-9a-fA-F]{8})/g, (_match, hex: string) => {
    const codePoint = Number.parseInt(hex, 16);
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return _match;
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  });

const decodeYamlKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(yamlDoubleQuotedToJson(key)) as string; }
    catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedText = (value: string) => {
  const normalized = normalizeAccess(value);
  return /github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalized);
};

const isQuotedAt = (line: string, index: number) => {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < index; i += 1) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'" && line[i + 1] === "'") { i += 1; continue; }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') { i += 1; continue; }
      if (char === '"') quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
  }
  return quote !== null;
};

const isInsideNamedFlowMapping = (line: string, index: number, mappingName: string) => {
  let quote: '"' | "'" | null = null;
  const stack: Array<string | null> = [];
  for (let i = 0; i < index; i += 1) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'" && line[i + 1] === "'") { i += 1; continue; }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') { i += 1; continue; }
      if (char === '"') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      const owner = line.slice(0, i).match(/(?:^|[,{])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/)?.[1];
      stack.push(owner ? decodeYamlKey(owner) : null);
      continue;
    }
    if (char === '}') stack.pop();
  }
  return stack.includes(mappingName);
};

const extractDirectRunValues = (workflow: string) => {
  const values: string[] = [];
  const lines = workflow.split('\n');
  const key = '(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\'\'|[^\'])*\'|[A-Za-z_][A-Za-z0-9_-]*)';
  const value = '("(?:\\\\.|[^"\\\\])*"|\'(?:\'\'|[^\'])*\'|[^,}]+)';
  const mapping = new RegExp(`(?=(?:^|[\\[,{]|-\\s+)\\s*(${key})\\s*:\\s*${value})`, 'g');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const match of line.matchAll(mapping)) {
      const matchIndex = match.index ?? 0;
      const prefixLength = line.slice(matchIndex).match(/^(?:[\[,{]|-\s+)?\s*/)?.[0].length ?? 0;
      const keyIndex = matchIndex + prefixLength;
      if (isQuotedAt(line, keyIndex)) continue;
      if (decodeYamlKey(match[1]) !== 'run') continue;
      if (isInsideNamedFlowMapping(line, keyIndex, 'with')) continue;
      values.push(match[2]);
    }

    const explicit = line.match(/^(\s*)-?\s*\?\s*(.+?)\s*(?:#.*)?$/);
    if (!explicit || decodeYamlKey(explicit[2]) !== 'run') continue;
    const explicitIndent = explicit[1].length;
    for (let valueIndex = lineIndex + 1; valueIndex < lines.length; valueIndex += 1) {
      const next = lines[valueIndex];
      if (!next.trim() || next.trimStart().startsWith('#')) continue;
      const indent = next.match(/^\s*/)?.[0].length ?? 0;
      if (indent < explicitIndent) break;
      const explicitValue = next.match(/^\s*:\s*(.+)$/);
      if (explicitValue) values.push(explicitValue[1]);
      break;
    }
  }
  return values;
};

const expectNoDirectUntrustedRun = (workflow: string, source: string) => {
  for (const value of extractDirectRunValues(workflow)) {
    expect(containsUntrustedText(value), `${source}: direct run key executes untrusted GitHub event text`).toBe(false);
  }
};

describe('direct GitHub workflow run-key security policy', () => {
  it('scans every checked-in workflow for flow-style and YAML-equivalent run keys', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoDirectUntrustedRun(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects untrusted text in a flow-style run mapping', () => {
    const unsafe = `steps: [{ run: 'bash -c "\${{ github.event.comment.body }}"' }]`;
    expect(() => expectNoDirectUntrustedRun(unsafe, 'flow-run.yml')).toThrow();
  });

  it('rejects untrusted text behind an escaped YAML run key', () => {
    const unsafe = `steps:\n  - "r\\u0075n": bash -c "\${{ github.event.comment.body }}"`;
    expect(() => expectNoDirectUntrustedRun(unsafe, 'escaped-run.yml')).toThrow();
  });

  it('rejects untrusted text behind an explicit YAML run key', () => {
    const unsafe = `steps:\n  - ? run\n    : bash -c '\${{ github.event.comment.body }}'`;
    expect(() => expectNoDirectUntrustedRun(unsafe, 'explicit-run.yml')).toThrow();
  });

  it('does not treat unrelated scalar text containing run as a run mapping', () => {
    const safe = `env: { NOTE: "prefix {run: '\${{ github.event.comment.body }}'} suffix" }\nsteps:\n  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567`;
    expectNoDirectUntrustedRun(safe, 'metadata.yml');
  });

  it('does not treat an action input named run as a shell step', () => {
    const safe = `steps:\n  - { uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { run: '\${{ github.event.comment.body }}' } }`;
    expectNoDirectUntrustedRun(safe, 'action-input.yml');
  });
});
