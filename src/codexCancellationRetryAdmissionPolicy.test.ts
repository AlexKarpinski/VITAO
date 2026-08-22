import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const remediationSchema = JSON.parse(readFileSync('.github/codex/remediation-record.schema.json', 'utf8'));

describe('Codex cancellation and retry admission policy', () => {
  it('keeps admission idempotent per command while requiring terminal evidence before a new retry', () => {
    expect(issueTrigger).toContain('const trustedRequestCommandIds = comments.flatMap((comment) => {');
    expect(issueTrigger).toContain('const currentCommandId = String(commandComment.id);');
    expect(issueTrigger).toContain('trustedRequestCommandIds.includes(currentCommandId)');
    expect(issueTrigger).toContain('A trusted Codex implementation request already exists for this command comment.');
    expect(issueTrigger).toContain('const previousCommandId = trustedRequestCommandIds.at(-1);');
    expect(issueTrigger).toContain('const hasTrustedTerminalResult = comments.some((comment) => {');
    expect(issueTrigger).toContain('codex-implementation-result:${previousCommandId}:${result}');
    expect(issueTrigger).toContain('no trusted terminal-result evidence yet');
    expect(issueTrigger).toContain('`- command comment ID: \\`${commandComment.id}\\`;`');
    expect(issueTrigger).toContain('`- workflow run ID: \\`${context.runId}\\`;`');
  });

  it('allows remediation cancellation records only with recoverable execution-run, branch, head, and reason evidence', () => {
    const statusValues = remediationSchema.properties.result.properties.status.enum;
    expect(statusValues).toContain('cancelled');
    expect(remediationSchema.properties.result.properties.executionWorkflowRunId.minimum).toBe(1);
    expect(remediationSchema.properties.result.properties.executionWorkflowRunId.description).toContain(
      'execution attempt itself',
    );
    expect(remediationSchema.properties.result.properties.executionWorkflowName.minLength).toBe(1);
    expect(remediationSchema.properties.result.properties.headSha.pattern).toBe('^[0-9a-f]{40}$');
    expect(remediationSchema.properties.result.properties.branch.minLength).toBe(1);
    expect(remediationSchema.properties.result.properties.cancellationReason.minLength).toBe(1);

    const cancelledRule = remediationSchema.properties.result.allOf.find(
      (rule: { if?: { properties?: { status?: { const?: string } } } }) => rule.if?.properties?.status?.const === 'cancelled',
    );
    expect(cancelledRule?.then?.required).toEqual([
      'executionWorkflowRunId',
      'executionWorkflowName',
      'headSha',
      'branch',
      'cancellationReason',
    ]);
  });
});
