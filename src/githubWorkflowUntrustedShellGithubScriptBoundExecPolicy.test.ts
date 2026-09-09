import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const containsUntrustedPayloadText = (value: string) => {
  const normalized = value
    .replace(/\?\./g, '.')
    .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, name, expression] of declarations) {
      if (tainted.has(name)) continue;
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPayloadText(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPayloadText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const collectBoundExecutionAliases = (script: string) => {
  const executionAliases = new Set<string>();

  for (const match of script.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:require\(\s*['"](?:node:)?child_process['"]\s*\)|(?:await\s+)?import\(\s*['"](?:node:)?child_process['"]\s*\))/g)) {
    for (const entry of match[1].split(',')) {
      const pair = entry.trim().match(/^(exec|execSync)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (pair) executionAliases.add(pair[2] ?? pair[1]);
    }
  }

  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*(?:exec|execSync)\b/g)) {
    executionAliases.add(match[1]);
  }

  const boundAliases = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*bind\s*\([^)]*\)/g)) {
    if (executionAliases.has(match[2])) boundAliases.add(match[1]);
  }

  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*(?:exec|execSync)\s*\.\s*bind\s*\([^)]*\)/g)) {
    boundAliases.add(match[1]);
  }

  return boundAliases;
};

const hasBoundUntrustedExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  for (const alias of collectBoundExecutionAliases(script)) {
    const matcher = new RegExp(`\\b${alias.replace(/[$]/g, '\\$&')}\\s*\\(([^)]*)\\)`, 'g');
    for (const match of script.matchAll(matcher)) {
      if (containsTaintedValue(match[1], tainted)) return true;
    }
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

const expectNoBoundGithubScriptExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasBoundUntrustedExecution(script),
      `${source}: bound child-process API executes attacker-controlled event text`,
    ).toBe(false);
  }
};

describe('GitHub Script bound child-process trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoBoundGithubScriptExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a bound execSync alias fed attacker-controlled text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { execSync } = require('node:child_process');",
      '            const run = execSync.bind(null);',
      '            run(context.payload.comment.body);',
    ].join('\n');
    expect(() => expectNoBoundGithubScriptExecution(unsafe, 'bound.yml')).toThrow();
  });

  it('rejects a directly bound child-process member fed a tainted local', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const run = require('child_process').exec.bind(null);",
      '            const command = context.payload.issue.title;',
      '            run(command);',
    ].join('\n');
    expect(() => expectNoBoundGithubScriptExecution(unsafe, 'direct-bound.yml')).toThrow();
  });

  it('allows a bound execSync alias with repository-owned constant text', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { execSync } = require('node:child_process');",
      '            const run = execSync.bind(null);',
      "            run('printf safe');",
    ].join('\n');
    expectNoBoundGithubScriptExecution(safe, 'bound-safe.yml');
  });
});
