import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1')
  .replace(/\[\s*(\d+)\s*\]/g, '.$1');

const pushCommitField = String.raw`(?:head_commit\.(?:message|author\.(?:name|email|username)|committer\.(?:name|email|username))|commits\.\d+\.(?:message|author\.(?:name|email|username)|committer\.(?:name|email|username)))`;

const containsUntrustedPushCommitText = (value: string) => {
  const normalized = normalizeAccess(value);
  return new RegExp(`(?:context\\.payload|github\\.event)\\.${pushCommitField}`).test(normalized);
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
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPushCommitText(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPushCommitText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const hasUntrustedPushCommitShellExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);

  for (const match of script.matchAll(/\b(?:exec|execSync)\s*(?:\?\.\s*)?\(([^;\n]*)\)/g)) {
    if (containsTaintedValue(match[1], tainted)) return true;
  }

  for (const match of script.matchAll(/\b(?:execFile|execFileSync|spawn|spawnSync)\s*(?:\?\.\s*)?\(([^;\n]*)\)/g)) {
    const args = match[1];
    const launchesShell = /^\s*['"`](?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)['"`]/i.test(args)
      || /^\s*['"`](?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)['"`]/i.test(args)
      || /\bshell\s*:\s*true\b/.test(args);
    if (launchesShell && containsTaintedValue(args, tainted)) return true;
  }

  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
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

const expectNoPushCommitShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasUntrustedPushCommitShellExecution(script),
      `${source}: GitHub Script executes attacker-controlled push commit metadata through a shell API`,
    ).toBe(false);
  }
};

describe('GitHub Script push commit metadata trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoPushCommitShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct execution of a push head commit message', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.head_commit.message);",
    ].join('\n');
    expect(() => expectNoPushCommitShellExecution(unsafe, 'push-message.yml')).toThrow();
  });

  it('rejects an aliased push commit author field executed through a shell', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const author = github.event.head_commit.author.name;',
      "            require('node:child_process').execSync(author);",
    ].join('\n');
    expect(() => expectNoPushCommitShellExecution(unsafe, 'push-author.yml')).toThrow();
  });

  it('rejects commit-array messages executed through a shell', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const message = context.payload.commits[0].message;',
      "            require('node:child_process').execSync(message);",
    ].join('\n');
    expect(() => expectNoPushCommitShellExecution(unsafe, 'push-commits.yml')).toThrow();
  });

  it('allows push commit metadata to be used as data beside a constant command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.head_commit.message);',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');
    expectNoPushCommitShellExecution(safe, 'push-safe.yml');
  });
});