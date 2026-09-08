import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedPayload = /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/;

const githubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+/.test(lines[index])) continue;
    const stepIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
    const step: string[] = [lines[index]];
    let end = index + 1;
    for (; end < lines.length; end += 1) {
      const line = lines[end];
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (line.trim() && indent === stepIndent && /^\s*-\s+/.test(line)) break;
      if (line.trim() && indent < stepIndent) break;
      step.push(line);
    }
    index = end - 1;

    if (!step.some((line) => /\buses\s*:\s*['"]?actions\/github-script@/.test(line))) continue;
    const scriptIndex = step.findIndex((line) => /^\s*script\s*:\s*[|>][-+1-9]*\s*$/.test(line));
    if (scriptIndex < 0) continue;
    const scriptIndent = step[scriptIndex].match(/^\s*/)?.[0].length ?? 0;
    const body: string[] = [];
    for (let child = scriptIndex + 1; child < step.length; child += 1) {
      const raw = step[child];
      if (raw.trim() && (raw.match(/^\s*/)?.[0].length ?? 0) <= scriptIndent) break;
      body.push(raw.trim());
    }
    bodies.push(body.join('\n'));
  }

  return bodies;
};

const balancedInitializer = (script: string, start: number) => {
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let quote: "'" | '"' | '`' | null = null;

  for (let index = start; index < script.length; index += 1) {
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
    if (char === '(') parens += 1;
    else if (char === ')') parens -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === ';' && parens === 0 && brackets === 0 && braces === 0) return script.slice(start, index);
  }

  return script.slice(start);
};

const taintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations: Array<[string, string]> = [];
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  for (let match = declaration.exec(script); match; match = declaration.exec(script)) {
    declarations.push([match[1], balancedInitializer(script, declaration.lastIndex)]);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, expression] of declarations) {
      if (tainted.has(name)) continue;
      const transitive = [...tainted].some((source) => new RegExp(`\\b${source.replace(/[$]/g, '\\$&')}\\b`).test(expression));
      if (!untrustedPayload.test(expression) && !transitive) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const hasUnsafeAliasedExecution = (script: string) => {
  const aliases = new Set<string>();
  for (const match of script.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:require\(\s*['"](?:node:)?child_process['"]\s*\)|(?:await\s+)?import\(\s*['"](?:node:)?child_process['"]\s*\))/g)) {
    for (const entry of match[1].split(',')) {
      const pair = entry.trim().match(/^(exec|execSync)\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (pair) aliases.add(pair[2]);
    }
  }

  const tainted = taintedIdentifiers(script);
  for (const alias of aliases) {
    const call = new RegExp(`\\b${alias.replace(/[$]/g, '\\$&')}\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
    for (let match = call.exec(script); match; match = call.exec(script)) {
      if (tainted.has(match[1])) return true;
    }
  }
  return false;
};

const expectSafe = (workflow: string, source: string) => {
  for (const script of githubScriptBodies(workflow)) {
    expect(hasUnsafeAliasedExecution(script), `${source}: aliased shell API executes multiline-assigned payload text`).toBe(false);
  }
};

describe('GitHub Script multiline assignment trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectSafe(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a parenthesized multiline taint assignment passed to an execSync alias', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { execSync: run } = require('node:child_process');",
      '            const command = (',
      '              context.payload.comment.body',
      '            );',
      '            run(command);',
    ].join('\n');
    expect(() => expectSafe(unsafe, 'multiline.yml')).toThrow();
  });

  it('allows a parenthesized multiline repository-owned constant', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const { execSync: run } = require('node:child_process');",
      '            const command = (',
      "              'printf safe'",
      '            );',
      '            run(command);',
    ].join('\n');
    expectSafe(safe, 'multiline-safe.yml');
  });
});
