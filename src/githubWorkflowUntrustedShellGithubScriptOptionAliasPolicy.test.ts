import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/;

type Quote = "'" | '"' | '`' | null;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
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

const extractSpawnCalls = (script: string) => {
  const calls: string[] = [];
  const matcher = /\b(?:spawn|spawnSync)\s*(?:\?\.\s*)?\(/g;
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: Quote = null;
    for (let index = open + 1; index < script.length; index += 1) {
      const char = script[index];
      if (quote) {
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char !== ')') continue;
      depth -= 1;
      if (depth !== 0) continue;
      calls.push(script.slice(open + 1, index));
      matcher.lastIndex = index + 1;
      break;
    }
  }
  return calls;
};

const splitTopLevelArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: Quote = null;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const collectShellOptionAliases = (script: string) => {
  const aliases = new Set<string>();
  for (const declaration of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\{[^;\n]*\})/g)) {
    if (/\bshell\s*:\s*true\b/.test(declaration[2])) aliases.add(declaration[1]);
  }
  return aliases;
};

const hasAliasedShellSpawn = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const shellOptions = collectShellOptionAliases(script);
  for (const call of extractSpawnCalls(script)) {
    const args = splitTopLevelArgs(call);
    if (args.length < 3) continue;
    const optionAlias = args[2].trim();
    if (!shellOptions.has(optionAlias)) continue;
    if (containsTaintedValue(args[0] ?? '', tainted)) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?(?:\s+#.*)?$/i);
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

const expectNoAliasedShellSpawn = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasAliasedShellSpawn(script),
      `${source}: GitHub Script executes attacker-controlled event text through aliased shell options`,
    ).toBe(false);
  }
};

describe('GitHub Script aliased spawn option trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoAliasedShellSpawn(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled spawn commands when shell options are aliased', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      '            const options = { shell: true };',
      '            cp.spawnSync(context.payload.comment.body, [], options);',
    ].join('\n');
    expect(() => expectNoAliasedShellSpawn(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects tainted local commands with aliased shell options', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const command = context.payload.issue.body;',
      '            const options = { shell: true };',
      "            require('node:child_process').spawn(command, [], options);",
    ].join('\n');
    expect(() => expectNoAliasedShellSpawn(unsafe, 'tainted-local.yml')).toThrow();
  });

  it('allows repository-owned commands with aliased shell options', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const options = { shell: true };',
      "            require('node:child_process').spawnSync('echo safe', [], options);",
    ].join('\n');
    expectNoAliasedShellSpawn(safe, 'safe.yml');
  });
});
