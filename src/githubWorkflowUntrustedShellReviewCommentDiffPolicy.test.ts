import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

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

const containsReviewCommentDiffHunk = (script: string) => {
  const normalized = script.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
  return /github\.event\.comment\.diff_hunk\b/.test(normalized);
};

const expectNoReviewDiffInShell = (workflow: string, source: string) => {
  for (const script of collectRunScripts(workflow)) {
    expect(
      containsReviewCommentDiffHunk(script),
      `${source}: run step interpolates contributor-controlled review-comment diff text`,
    ).toBe(false);
  }
};

describe('GitHub workflow review-comment diff shell policy', () => {
  it('rejects review-comment diff hunks in inline and block run steps', () => {
    const unsafe = [
      'steps:',
      "  - run: bash -c '${{ github.event.comment.diff_hunk }}'",
      '  - run: |',
      '      bash -c "${{ github[\'event\'][\'comment\'][\'diff_hunk\'] }}"',
    ].join('\n');

    expect(() => expectNoReviewDiffInShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows review-comment diff text in non-shell action configuration', () => {
    const safe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    env:',
      '      DIFF: ${{ github.event.comment.diff_hunk }}',
      '    with:',
      '      script: core.info(process.env.DIFF ?? "")',
    ].join('\n');

    expectNoReviewDiffInShell(safe, 'safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectNoReviewDiffInShell(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
