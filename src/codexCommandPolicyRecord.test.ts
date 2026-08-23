import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type CommandPolicy = {
  policyVersion: number;
  readinessLabel: string;
  implementationCommand: string;
  implementationEvent: string;
  automaticRemediationOptInLabel: string;
  automaticRemediationEvent: string;
  manualRemediationCommand: string | null;
  notes: string;
};

const policy = JSON.parse(
  readFileSync('.github/codex/command-policy.json', 'utf8')
) as CommandPolicy;
const implementationWorkflow = readFileSync(
  '.github/workflows/codex-issue-trigger.yml',
  'utf8'
);
const remediationWorkflow = readFileSync(
  '.github/workflows/codex-ci-fix-trigger.yml',
  'utf8'
);

describe('Codex command and label policy', () => {
  it('records only repository-enforced implementation admission', () => {
    expect(policy.policyVersion).toBeGreaterThanOrEqual(1);
    expect(policy.readinessLabel).toBe('ready-for-codex');
    expect(policy.implementationCommand).toBe('/codex implement');
    expect(policy.implementationEvent).toBe('issue_comment.created');
    expect(implementationWorkflow).toContain("types: [created]");
    expect(implementationWorkflow).toContain("github.event.comment.body == '/codex implement'");
    expect(implementationWorkflow).toContain("labels.includes('ready-for-codex')");
  });

  it('records the implemented automatic remediation opt-in instead of inventing a manual command', () => {
    expect(policy.automaticRemediationOptInLabel).toBe('codex-auto-fix');
    expect(policy.automaticRemediationEvent).toBe('workflow_run.completed:CI:failure');
    expect(remediationWorkflow).toContain('workflow_run:');
    expect(remediationWorkflow).toContain("conclusion == 'failure'");
    expect(remediationWorkflow).toContain("labels.includes('codex-auto-fix')");
    expect(policy.manualRemediationCommand).toBeNull();
    expect(policy.notes).toContain('/codex fix-review');
    expect(policy.notes).toContain('not implemented');
  });
});
