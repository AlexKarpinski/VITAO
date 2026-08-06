import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');

describe('Codex CI-fix trigger policy', () => {
  it('runs only after failed CI and serializes trigger jobs per PR', () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow).toContain('group: codex-ci-fix-${{ github.event.workflow_run.pull_requests[0].number || github.event.workflow_run.id }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('requires exactly one open opted-in PR at the failed SHA', () => {
    expect(workflow).toContain('prs.length !== 1');
    expect(workflow).toContain('github.rest.pulls.get');
    expect(workflow).toContain("pullRequest.state === 'open'");
    expect(workflow).toContain('pullRequest.head.sha === workflowRun.head_sha');
    expect(workflow).toContain("labels.includes('codex-auto-fix')");
  });

  it('permits only one trusted automatic remediation request per PR', () => {
    expect(workflow).toContain('codex-ci-fix-requested:${prNumber}');
    expect(workflow).toContain("comment.user?.login !== 'github-actions[bot]'");
    expect(workflow).toContain("comment.user?.type !== 'Bot'");
    expect(workflow).toContain('startsWith(`${requestMarker}\\n${requestPrefix}`)');
    expect(workflow).toContain('single automatic remediation request permitted for this PR');
  });

  it('revalidates state, SHA, and opt-in immediately before posting', () => {
    expect(workflow.match(/await getCurrentPullRequest\(\)/g)).toHaveLength(2);
    expect(workflow.match(/isEligible\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(workflow).toContain('changed state, head SHA, or opt-in while the request was being prepared');
    expect(workflow).toContain('await github.rest.issues.createComment');
  });

  it('binds the request to the exact failed run and revision', () => {
    expect(workflow).toContain('Failed workflow run ${workflowRun.id}');
    expect(workflow).toContain('Failed head SHA: ${workflowRun.head_sha}');
    expect(workflow).toContain('confirm the PR head still matches the failed SHA before editing');
  });
});
