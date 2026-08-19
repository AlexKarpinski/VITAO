import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');

describe('Codex issue trigger concurrency policy', () => {
  it('serializes implementation trigger runs per issue without cancelling an active run', () => {
    expect(issueTrigger).toContain('group: codex-issue-${{ github.event.issue.number }}');
    expect(issueTrigger).toContain('cancel-in-progress: false');
  });

  it('admits only newly created exact implementation commands on issue comments', () => {
    expect(issueTrigger).toContain('issue_comment:');
    expect(issueTrigger).toContain('types: [created]');
    expect(issueTrigger).toContain("github.event.comment.body == '/codex implement'");
    expect(issueTrigger).toContain('github.event.issue.pull_request == null');
  });

  it('rejects bots and untrusted actors before the implementation trigger runs', () => {
    expect(issueTrigger).toContain("github.event.comment.user.type == 'User'");
    expect(issueTrigger).toContain('contains(fromJSON(\'["OWNER", "MEMBER", "COLLABORATOR"]\'), github.event.comment.author_association)');
    expect(issueTrigger).not.toContain('github.event.comment.user.type == \'Bot\'');
  });

  it('keeps the readiness label check in the trigger path', () => {
    expect(issueTrigger).toContain("const readyLabel = 'ready-for-codex';");
    expect(issueTrigger).toContain('if (!labels.includes(readyLabel))');
  });
});
