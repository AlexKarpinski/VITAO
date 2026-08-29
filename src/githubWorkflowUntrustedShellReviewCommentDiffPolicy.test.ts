import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) =>
  value.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsReviewCommentShellSource = (value: string) => {
  const normalized = normalizeAccess(value);
  return /github\.event\.comment\.(?:diff_hunk|path)\b/.test(normalized);
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?(?:run|['"]run['"])\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = match[2].trim();
    if (!/^[|>][+-]?[1-9]?$|^[|>][1-9][+-]?$/.test(value.split(/\s+#/)[0].trim())) {
      scripts.push(value);
      continue;
    }

    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childLine.trim() && childIndent <= indent) break;
      if (childLine.trim()) body.push(childLine.trim());
      index = child;
    }
    scripts.push(body.join('\n'));
  }

  return scripts;
};

const collectTaintedEnv = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (/^(?:env|['"]env['"])\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }
    if (envIndent === null) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }

    const entry = trimmed.match(/^(?:['"])?([A-Za-z_][A-Za-z0-9_]*)(?:['"])?\s*:\s*(.+)$/);
    if (entry && containsReviewCommentShellSource(entry[2])) names.add(entry[1]);
  }

  return names;
};

const reachesExecutionSink = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variable = `(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`;
  return new RegExp(`(?:bash\\s+-c|sh\\s+-c|eval|Invoke-Expression)\\s+[\\s\\S]*${variable}`, 'i').test(script);
};

const expectNoReviewCommentTextInShell = (workflow: string, source: string) => {
  const taintedEnv = collectTaintedEnv(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(
      containsReviewCommentShellSource(script),
      `${source}: run step interpolates contributor-controlled review-comment text`,
    ).toBe(false);

    for (const name of taintedEnv) {
      expect(
        reachesExecutionSink(script, name),
        `${source}: run step executes contributor-controlled review-comment text through env ${name}`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow review-comment shell policy', () => {
  it('rejects review-comment diff hunks and paths in run steps', () => {
    const unsafe = [
      'steps:',
      "  - run: bash -c '${{ github.event.comment.diff_hunk }}'",
      '  - run: |',
      '      bash -c "${{ github[\'event\'][\'comment\'][\'path\'] }}"',
    ].join('\n');

    expect(() => expectNoReviewCommentTextInShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects review-comment paths propagated through env into an execution sink', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.path }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoReviewCommentTextInShell(unsafe, 'env-unsafe.yml')).toThrow();
  });

  it('allows review-comment text in non-shell action configuration', () => {
    const safe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    env:',
      '      PATH_TEXT: ${{ github.event.comment.path }}',
      '    with:',
      '      script: core.info(process.env.PATH_TEXT ?? "")',
    ].join('\n');

    expectNoReviewCommentTextInShell(safe, 'safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectNoReviewCommentTextInShell(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
