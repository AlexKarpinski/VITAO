import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const decodeYamlKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/
    .test(normalizeAccess(value));

const shellReferences = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?::[^}]*)?\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const splitTopLevel = (body: string) => {
  const entries: string[] = [];
  let quote: '"' | "'" | null = null;
  let curly = 0;
  let square = 0;
  let expressionDepth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '$' && next === '{' && body[index + 2] === '{') { expressionDepth += 1; index += 2; continue; }
    if (expressionDepth > 0 && char === '}' && next === '}') { expressionDepth -= 1; index += 1; continue; }
    if (expressionDepth > 0) continue;
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

const flowEnvBodies = (workflow: string) => {
  const bodies: string[] = [];
  for (const line of workflow.split('\n')) {
    const envIndex = line.search(/\benv\s*:/);
    if (envIndex < 0) continue;
    const opening = line.indexOf('{', envIndex);
    const closing = line.lastIndexOf('}');
    if (opening >= 0 && closing > opening) bodies.push(line.slice(opening + 1, closing));
  }
  return bodies;
};

const collectFlowEnvTaint = (workflow: string) => {
  const tainted = new Set<string>();
  for (const body of flowEnvBodies(workflow)) {
    for (const entry of splitTopLevel(body)) {
      const mapping = entry.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.*)$/);
      if (!mapping) continue;
      const name = decodeYamlKey(mapping[1]);
      if (isUntrusted(mapping[2])) tainted.add(name);
    }
  }
  return tainted;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const keyPattern = /(?:^|\n)\s*(?:-\s*)?((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*([^\n]+)/g;
  for (const match of workflow.matchAll(keyPattern)) {
    if (decodeYamlKey(match[1]) === 'run') scripts.push(match[2].trim());
  }
  return scripts;
};

const expectNoYamlKeyShellBypass = (workflow: string) => {
  const tainted = collectFlowEnvTaint(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(isUntrusted(script), `direct untrusted text reaches run: ${script}`).toBe(false);
    for (const name of tainted) {
      expect(shellReferences(script, name), `tainted flow env ${name} reaches run`).toBe(false);
    }
  }
};

describe('GitHub workflow YAML key shell policy', () => {
  it('enforces flow-env and decoded run-key boundaries across checked-in workflows', () => {
    for (const name of workflowFiles) {
      expectNoYamlKeyShellBypass(readFileSync(join(workflowsDir, name), 'utf8'));
    }
  });

  it('rejects tainted flow-style env values reaching shell', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    env: { CMD: "${{ github.event.comment.body }}" }',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoYamlKeyShellBypass(unsafe)).toThrow();
  });

  it('rejects YAML-escaped run keys carrying untrusted text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - "r\\u0075n": bash -c "${{ github.event.comment.body }}"',
    ].join('\n');
    expect(() => expectNoYamlKeyShellBypass(unsafe)).toThrow();
  });
});
