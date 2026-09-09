import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeBracketAccess = (value: string) =>
  value.replace(/\[\s*(['"])([A-Za-z_][A-Za-z0-9_-]*)\1\s*\]/g, '.$2');

const untrustedPaths = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
  'github.event.discussion.body',
];

const containsSpacedBracketUntrustedAccess = (value: string) => {
  const normalized = normalizeBracketAccess(value);
  return untrustedPaths.some((path) => normalized.includes(path));
};

const collectRunLikeValues = (workflow: string) =>
  workflow
    .split('\n')
    .filter((line) => /(?:^|\s)(?:run|["']run["'])\s*:/.test(line))
    .map((line) => line.replace(/^.*?(?:run|["']run["'])\s*:\s*/, ''));

const expectNoSpacedBracketUntrustedShellAccess = (workflow: string, source: string) => {
  for (const value of collectRunLikeValues(workflow)) {
    expect(
      containsSpacedBracketUntrustedAccess(value),
      `${source}: run step references untrusted event text through spaced bracket access`,
    ).toBe(false);
  }
};

describe('GitHub workflow spaced bracket untrusted-shell policy', () => {
  it('checks every repository workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectNoSpacedBracketUntrustedShellAccess(workflow, workflowFile);
    }
  });

  it('rejects whitespace around bracketed GitHub expression keys', () => {
    const unsafe = [
      'steps:',
      '  - run: bash -c "${{ github[ \'event\' ][ \'comment\' ][ \'body\' ] }}"',
      '  - run: bash -c "${{ github[ \"event\" ][ \"issue\" ][ \"body\" ] }}"',
    ].join('\n');

    expect(() => expectNoSpacedBracketUntrustedShellAccess(unsafe, 'unsafe.yml')).toThrow();
  });

  it('keeps unrelated bracketed values allowed', () => {
    const safe = 'steps:\n  - run: echo "${{ github[ \'repository\' ] }}"';
    expectNoSpacedBracketUntrustedShellAccess(safe, 'safe.yml');
  });
});
