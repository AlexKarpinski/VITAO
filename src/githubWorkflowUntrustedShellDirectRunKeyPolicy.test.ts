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

const extractDirectRunValues = (workflow: string) => {
  const values: string[] = [];
  const key = '(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\'\'|[^\'])*\'|[A-Za-z_][A-Za-z0-9_-]*)';
  // Include '[' because flow-style step sequences begin with `[{ run: ... }]`.
  const mapping = new RegExp(`(?:^|[\\[,{])\\s*(${key})\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|\'(?:\'\'|[^\'])*\'|[^,}]+)`, 'g');

  for (const line of workflow.split('\n')) {
    for (const match of line.matchAll(mapping)) {
      if (decodeYamlKey(match[1]) === 'run') values.push(match[2]);
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

  it('does not treat unrelated scalar text containing run as a run mapping', () => {
    const safe = `env: { NOTE: "run: \${{ github.event.comment.body }}" }`;
    expectNoDirectUntrustedRun(safe, 'metadata.yml');
  });
});
