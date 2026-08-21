import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('.github/codex/README.md', 'utf8');
const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const ciFixTrigger = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');
const triggerWorkflows = [issueTrigger, ciFixTrigger];

const githubScriptAction = 'actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea';

function assertInactiveTrigger(workflow: string, exactPermissions: string[]) {
  expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
  expect(workflow).not.toMatch(/^\s*(?:-\s*)?run:/m);
  expect(workflow).not.toContain('permissions: write-all');

  const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map(
    (match) => match[1]
  );
  expect(uses).toEqual([githubScriptAction]);

  const permissionsBlock = workflow.match(/permissions:\n((?:\s{2}[^\n]+\n)+)/)?.[1] ?? '';
  const permissions = permissionsBlock
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim())
    .sort();
  expect(permissions).toEqual([...exactPermissions].sort());
}

function getEnvValue(workflow: string, key: string) {
  const prefix = `${key}:`;
  const line = workflow
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));

  return line?.slice(prefix.length).trim();
}

describe('Codex runtime operations policy', () => {
  it('keeps the worker inactive until owner-controlled runtime decisions are documented', () => {
    expect(readme).toContain('These files are **inactive groundwork only**.');
    expect(readme).toContain('OpenAI/Codex credential, model, token, and API-budget strategy');
    expect(readme).toContain('which trusted operators are authorized to cancel worker runs');
    expect(readme).toContain('branch-protection and merge policy');

    assertInactiveTrigger(issueTrigger, ['contents: read', 'issues: write']);
    assertInactiveTrigger(ciFixTrigger, [
      'pull-requests: read',
      'issues: write',
      'actions: read',
      'contents: read',
    ]);

    for (const workflow of triggerWorkflows) {
      expect(workflow).not.toContain('actions/checkout@');
      expect(workflow).not.toContain('OPENAI_API_KEY');
      expect(workflow).not.toContain('CODEX_API_KEY');
      expect(workflow).not.toContain('openai/codex');
      expect(workflow).not.toContain('codex exec');
      expect(workflow).not.toContain('workspace-write');
      expect(workflow).not.toContain('contents: write');
    }
  });

  it('requires an explicit fail-closed repository enable switch before implementation admission', () => {
    expect(getEnvValue(issueTrigger, 'CODEX_WORKER_ENABLED')).toBe(
      "${{ vars.CODEX_WORKER_ENABLED || 'false' }}"
    );
    expect(issueTrigger).toContain("if (process.env.CODEX_WORKER_ENABLED !== 'true')");
    expect(issueTrigger).toContain('the repository Codex worker enable switch is off');
    expect(readme).toContain('`CODEX_WORKER_ENABLED=true`');
    expect(readme).toContain('unset or any value other than `true` keeps implementation admission disabled');
  });

  it('bounds trigger execution without pretending that it bounds downstream API spend', () => {
    expect(readme).toContain('`.github/workflows/codex-issue-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('`.github/workflows/codex-ci-fix-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('they are not approval for an unbounded downstream implementation/remediation process');
    expect(readme).toContain('Model choice and token/cost limits must be explicitly documented before the worker is enabled.');
  });

  it('defines recoverable manual cancellation and explicit retry semantics before activation', () => {
    expect(readme).toContain('## Cancellation and retry policy');
    expect(readme).toContain('It is not evidence that an already-running worker was cancelled.');
    expect(readme).toContain('cancel the specific GitHub Actions workflow run through GitHub Actions controls (UI or API)');
    expect(readme).toContain('verify that GitHub records the run as cancelled before claiming cancellation succeeded');
    expect(readme).toContain('Cancellation must leave the existing issue branch and PR recoverable.');
    expect(readme).toContain('A cancelled run must be recorded as the terminal result `cancelled`');
    expect(readme).toContain('Cancellation does not automatically authorize a retry.');
    expect(readme).toContain('Retry requires a new explicit request from a trusted actor');
    expect(readme).toContain('Do not automatically retry after cancellation, timeout, owner-input blockers, unsafe branch drift, or failed required validation.');
    expect(readme).toContain('keep general activation blocked until a separate verified cancellation mechanism exists');
  });

  it('requires one successful small non-critical pilot before general worker activation', () => {
    expect(readme).toContain('a small, non-critical pilot issue and the evidence required to declare that pilot successful');
    expect(readme).toContain('do not treat the worker as generally enabled until one small, non-critical pilot issue has completed the full implementation path');
    expect(readme).toContain('GitHub-verifiable evidence for admission, deterministic branch/PR reuse, required validation, exact-SHA review, recoverable failure handling, and final Delivery Engine reconciliation');
    expect(readme).toContain('A failed or incomplete pilot keeps general worker activation blocked');
    expect(readme).toContain('an incomplete or failed pilot is not sufficient');
  });
});
