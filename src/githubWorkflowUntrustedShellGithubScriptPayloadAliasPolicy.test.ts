import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const isPayloadRoot = (value: string) => /^(?:context\.payload|github\.event)(?:\.[A-Za-z_$][\w$-]*)*$/.test(value);
const isUntrustedTextPath = (value: string) => /^(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))$/.test(value);

const collectAliasState = (script: string) => {
  const objectAliases = new Map<string, string>();
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const local = declaration[1];
      let expression = normalizePayloadAccess(declaration[2].trim());
      const aliasAccess = expression.match(/^([A-Za-z_$][\w$]*)(\.[A-Za-z_$][\w$-]*)*$/);
      if (aliasAccess) {
        const root = expression.match(/^([A-Za-z_$][\w$]*)/)?.[1];
        const canonical = root && objectAliases.get(root);
        if (canonical) expression = `${canonical}${expression.slice(root.length)}`;
      }

      if (isUntrustedTextPath(expression) && !tainted.has(local)) {
        tainted.add(local);
        changed = true;
        continue;
      }
      if (tainted.has(expression) && !tainted.has(local)) {
        tainted.add(local);
        changed = true;
        continue;
      }
      if (isPayloadRoot(expression) && objectAliases.get(local) !== expression) {
        objectAliases.set(local, expression);
        changed = true;
      }
    }
  }

  return { objectAliases, tainted };
};

const argumentIsTainted = (argument: string, objectAliases: Map<string, string>, tainted: Set<string>) => {
  let normalized = normalizePayloadAccess(argument.trim());
  const root = normalized.match(/^([A-Za-z_$][\w$]*)/)?.[1];
  const canonical = root && objectAliases.get(root);
  if (canonical) normalized = `${canonical}${normalized.slice(root.length)}`;
  if (isUntrustedTextPath(normalized)) return true;
  return [...tainted].some((name) => new RegExp(`\\b${name.replace(/[$]/g, '\\$&')}\\b`).test(argument));
};

const hasAliasedPayloadShellExecution = (script: string) => {
  const { objectAliases, tainted } = collectAliasState(script);
  for (const match of script.matchAll(/\b(?:exec|execSync)\s*\(([^)]+)\)/g)) {
    const command = match[1].split(',')[0] ?? '';
    if (argumentIsTainted(command, objectAliases, tainted)) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*(?:#.*)?$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoAliasedPayloadShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasAliasedPayloadShellExecution(script),
      `${source}: attacker-controlled payload text reaches a shell API through an object alias`,
    ).toBe(false);
  }
};

describe('GitHub Script payload object alias shell boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoAliasedPayloadShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a comment object alias passed to execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const comment = context.payload.comment;',
      "            require('node:child_process').execSync(comment.body);",
    ].join('\n');
    expect(() => expectNoAliasedPayloadShellExecution(unsafe, 'payload-alias.yml')).toThrow();
  });

  it('rejects nested payload aliases before shell execution', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const payload = context.payload;',
      '            const issue = payload.issue;',
      '            const command = issue.body;',
      "            require('node:child_process').exec(command);",
    ].join('\n');
    expect(() => expectNoAliasedPayloadShellExecution(unsafe, 'nested-payload-alias.yml')).toThrow();
  });

  it('allows non-text metadata beside a constant shell command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const comment = context.payload.comment;',
      '            core.info(String(comment.id));',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');
    expectNoAliasedPayloadShellExecution(safe, 'safe-payload-alias.yml');
  });
});
