import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const remediationSchema = JSON.parse(readFileSync('.github/codex/remediation-record.schema.json', 'utf8'));

describe('Codex cancellation and retry admission policy', () => {
  it('keeps admission idempotent per command while allowing a new explicit retry command to receive fresh provenance', () => {
    expect(issueTrigger).toContain('const commandProvenance = `- command comment ID: \\`${commandComment.id}\\`;`;');
    expect(issueTrigger).toContain('hasTrustedRequestForCommand');
    expect(issueTrigger).toContain("body.includes(commandProvenance)");
    expect(issueTrigger).toContain('A trusted Codex implementation request already exists for this command comment.');
    expect(issueTrigger).toContain('`- command comment ID: \\`${commandComment.id}\\`;`');
    expect(issueTrigger).toContain('`- workflow run ID: \\`${context.runId}\\`;`');
  });

  it('allows remediation cancellation records only with recoverable GitHub run, branch, head, and reason evidence', () => {
    const statusValues = remediationSchema.properties.result.properties.status.enum;
    expect(statusValues).toContain('cancelled');
    expect(remediationSchema.properties.result.properties.workflowRunId.minimum).toBe(1);
    expect(remediationSchema.properties.result.properties.headSha.pattern).toBe('^[0-9a-f]{40}$');
    expect(remediationSchema.properties.result.properties.branch.minLength).toBe(1);
    expect(remediationSchema.properties.result.properties.cancellationReason.minLength).toBe(1);

    const cancelledRule = remediationSchema.properties.result.allOf.find(
      (rule: { if?: { properties?: { status?: { const?: string } } } }) => rule.if?.properties?.status?.const === 'cancelled',
    );
    expect(cancelledRule?.then?.required).toEqual([
      'workflowRunId',
      'headSha',
      'branch',
      'cancellationReason',
    ]);
  });
});
