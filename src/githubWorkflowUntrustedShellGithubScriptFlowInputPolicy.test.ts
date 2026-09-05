import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const decodeYamlQuotedScalar = (value: string) => {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return null;
};

const flowGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  for (const line of workflow.split('\n')) {
    if (!/actions\/github-script@/.test(line) || !/\bwith\s*:\s*\{/.test(line)) continue;
    const script = line.match(/\bscript\s*:\s*("(?:\\.|[^"])*"|'(?:''|[^'])*')/);
    if (!script) continue;
    const decoded = decodeYamlQuotedScalar(script[1]);
    if (decoded !== null) bodies.push(decoded);
  }
  return bodies;
};

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const [, name, expression] = declaration;
      if (tainted.has(name)) continue;
      const dependsOnTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPayloadText(expression) && !dependsOnTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const hasUntrustedShellExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const calls = script.matchAll(/(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\b(?:exec|execSync)\s*(?:\?\.\s*)?\(([^)]*)\)/g);
  for (const call of calls) {
    const argument = call[1] ?? '';
    if (containsUntrustedPayloadText(argument)) return true;
    if ([...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(argument))) {
      return true;
    }
  }
  return false;
};

const expectFlowGithubScriptInputsSafe = (workflow: string, source: string) => {
  for (const script of flowGithubScriptBodies(workflow)) {
    expect(
      hasUntrustedShellExecution(script),
      `${source}: flow-style GitHub Script executes attacker-controlled text`,
    ).toBe(false);
  }
};

describe('flow-style GitHub Script input trust boundary', () => {
  it('rejects a flow-style script that aliases comment text into execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      `      - { uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { script: "const command = context.payload.comment.body; require('node:child_process').execSync(command)" } }`,
    ].join('\n');

    expect(() => expectFlowGithubScriptInputsSafe(unsafe, 'flow-unsafe.yml')).toThrow();
  });

  it('allows flow-style GitHub Script to consume comment text only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      `      - { uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { script: "core.info(context.payload.comment.body)" } }`,
    ].join('\n');

    expectFlowGithubScriptInputsSafe(safe, 'flow-safe.yml');
  });

  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectFlowGithubScriptInputsSafe(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
