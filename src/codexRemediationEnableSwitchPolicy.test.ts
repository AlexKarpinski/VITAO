import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const ciFixTrigger = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');
const readme = readFileSync('.github/codex/README.md', 'utf8');

const enableMapping = "CODEX_WORKER_ENABLED: ${{ vars.CODEX_WORKER_ENABLED || 'false' }}";
const failClosedGuard = "process.env.CODEX_WORKER_ENABLED !== 'true'";

describe('Codex remediation enable-switch policy', () => {
  it('uses the same fail-closed repository switch for implementation and automatic CI remediation', () => {
    expect(issueTrigger).toContain(enableMapping);
    expect(ciFixTrigger).toContain(enableMapping);
    expect(issueTrigger).toContain(failClosedGuard);
    expect(ciFixTrigger).toContain(failClosedGuard);
  });

  it('stops automatic CI remediation before PR lookup or request creation when disabled', () => {
    const disabledGuard = ciFixTrigger.indexOf(failClosedGuard);
    const pullRequestLookup = ciFixTrigger.indexOf('const getCurrentPullRequest = async () =>');
    const requestCreation = ciFixTrigger.lastIndexOf('await github.rest.issues.createComment({');

    expect(disabledGuard).toBeGreaterThan(-1);
    expect(pullRequestLookup).toBeGreaterThan(disabledGuard);
    expect(requestCreation).toBeGreaterThan(pullRequestLookup);
    expect(ciFixTrigger).toContain('Automatic Codex CI remediation is disabled by the repository worker enable switch.');
  });

  it('documents that the switch blocks new admissions without claiming cancellation of running work', () => {
    expect(readme).toContain('both implementation and automatic CI-remediation admission disabled');
    expect(readme).toContain('disable switch for new Codex admissions');
    expect(readme).toContain('does not cancel a downstream worker that has already started');
  });
});
