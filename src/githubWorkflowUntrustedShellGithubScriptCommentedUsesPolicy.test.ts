import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\' && quote === '"') { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = stripYamlComment(lines[index]);
    const uses = normalized.match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = stripYamlComment(script[1]).trim();
      if (value && !blockHeader.test(value)) { bodies.push(value); break; }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        if (bodyRaw.trim() && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyRaw.trim()) body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const unsafeGithubScriptShell = (script: string) =>
  /(?:exec|execSync)\s*\([^)]*context\.payload\.(?:issue|comment|pull_request|review|discussion)\.(?:title|body|diff_hunk|path)/s.test(script)
  || /(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"](?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)['"]\s*,\s*\[[^\]]*['"]-c['"][^\]]*context\.payload\./s.test(script);

const expectNoCommentedGithubScriptShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(unsafeGithubScriptShell(script), `${source}: commented github-script reference executes untrusted payload text`).toBe(false);
  }
};

describe('GitHub Script references with YAML comments', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoCommentedGithubScriptShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects a commented github-script action reference that executes comment text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567 # v7.0.1',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.comment.body);",
    ].join('\n');
    expect(() => expectNoCommentedGithubScriptShellExecution(unsafe, 'commented-uses.yml')).toThrow();
  });

  it('allows a commented github-script action reference when payload is only data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567 # v7.0.1',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
    ].join('\n');
    expectNoCommentedGithubScriptShellExecution(safe, 'commented-uses-safe.yml');
  });
});
