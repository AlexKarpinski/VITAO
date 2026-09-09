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
  return /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedIdentifiers = (script: string) => {
  const assignments = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  const tainted = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const [, name, value] of assignments) {
      if (tainted.has(name)) continue;
      const derived = containsUntrustedPayloadText(value)
        || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));
      if (!derived) continue;
      tainted.add(name);
      changed = true;
    }
  }

  return tainted;
};

const hasTaintedIndirectEval = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const argumentIsTainted = (argument: string) => containsUntrustedPayloadText(argument)
    || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(argument));
  const evalTarget = String.raw`(?:(?:globalThis|global|window|self)\s*(?:\.\s*eval|\[\s*['"]eval['"]\s*\])|eval)`;

  for (const match of script.matchAll(new RegExp(`${evalTarget}\\s*\\.\\s*call\\s*\\(\\s*[^,]*,\\s*([^\\n;)]+)`, 'g'))) {
    if (argumentIsTainted(match[1])) return true;
  }

  for (const match of script.matchAll(new RegExp(`${evalTarget}\\s*\\.\\s*apply\\s*\\(\\s*[^,]*,\\s*\\[([^\\]]*)\\]`, 'g'))) {
    if (match[1].split(',').some((argument) => argumentIsTainted(argument.trim()))) return true;
  }

  return false;
};

const expectNoTaintedIndirectEval = (workflow: string, source: string) => {
  expect(hasTaintedIndirectEval(workflow), `${source}: indirect eval executes attacker-controlled code`).toBe(false);
};

describe('GitHub Script indirect eval invocation policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoTaintedIndirectEval(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects eval.call with attacker-controlled payload text', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            eval.call(null, context.payload.comment.body);'].join('\n');
    expect(() => expectNoTaintedIndirectEval(unsafe, 'eval-call.yml')).toThrow();
  });

  it('rejects member eval.apply through a local tainted alias', () => {
    const unsafe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', '            const code = context.payload.pull_request.title;', "            globalThis['eval'].apply(null, [code]);"].join('\n');
    expect(() => expectNoTaintedIndirectEval(unsafe, 'eval-apply.yml')).toThrow();
  });

  it('allows indirect eval invocation with repository-owned constant code', () => {
    const safe = ['jobs:', '  test:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        with:', '          script: |', "            const result = eval.call(null, '2 + 2');", "            const other = globalThis.eval.apply(null, ['3 + 3']);", '            core.info(String(result + other));'].join('\n');
    expectNoTaintedIndirectEval(safe, 'eval-indirect-safe.yml');
  });
});
