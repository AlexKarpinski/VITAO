import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');

describe('Codex CI-fix trigger policy', () => {
  it('runs only after failed CI and serializes requests per PR', () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow).toContain('group: codex-ci-fix-${{ github.event.workflow_run.pull_requests[0].number || github.event.workflow_run.id }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('requires exactly one open PR at the failed SHA', () => {
    expect(workflow).toContain('prs.length !== 1');
    expect(workflow).toContain('github.rest.pulls.get');
    expect(workflow).toContain("pullRequest.state !== 'open'");
    expect(workflow).toContain('pullRequest.head.sha !== workflowRun.head_sha');
  });

  it('requires the explicit opt-in label', () => {
    expect(workflow).toContain("labels.includes('codex-auto-fix')");
  });

  it('accepts duplicate markers only from GitHub Actions', () => {
    expect(workflow).toContain("comment.user?.login !== 'github-actions[bot]'");
    expect(workflow).toContain("comment.user?.type !== 'Bot'");
    expect(workflow).toContain('startsWith(`${requestMarker}\\n${requestPrefix}`)');
  });

  it('binds the remediation request to the workflow run and exact head SHA', () => {
    expect(workflow).toContain('codex-ci-fix-requested:${workflowRun.id}:${workflowRun.head_sha}');
    expect(workflow).toContain('Failed head SHA: ${workflowRun.head_sha}');
    expect(workflow).toContain('confirm the PR head still matches the failed SHA before editing');
  });
});
