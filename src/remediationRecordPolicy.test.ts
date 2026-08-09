import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = JSON.parse(
  readFileSync('.github/codex/remediation-record.schema.json', 'utf8'),
) as {
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, any>;
};

describe('Codex remediation decision record contract', () => {
  it('requires the evidence needed to tie a finding to one reviewed revision', () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      'source',
      'reviewedSha',
      'severity',
      'target',
      'evidence',
      'decision',
      'verification',
      'automation',
      'result',
    ]);
    expect(schema.properties.reviewedSha.pattern).toBe('^[0-9a-f]{40}$');
  });

  it('keeps finding classification aligned with Issue #37', () => {
    expect(schema.properties.severity.enum).toEqual([
      'BLOCKER',
      'MAJOR',
      'MINOR',
      'QUESTION',
      'NON_ACTIONABLE',
    ]);
  });

  it('records evidence, target, decision, verification, and automation eligibility', () => {
    expect(schema.properties.target.required).toContain('summary');
    expect(schema.properties.evidence.minLength).toBe(1);
    expect(schema.properties.decision.required).toEqual(['action', 'reason']);
    expect(schema.properties.decision.properties.action.enum).toEqual([
      'fix',
      'challenge',
      'defer',
      'escalate',
    ]);
    expect(schema.properties.verification.required).toEqual(['method', 'status']);
    expect(schema.properties.automation.required).toEqual(['eligible', 'reason']);
  });

  it('supports only explicit remediation outcomes and exact commit identities', () => {
    expect(schema.properties.result.required).toEqual(['status']);
    expect(schema.properties.result.properties.status.enum).toEqual([
      'pending',
      'fixed',
      'challenged',
      'deferred',
      'escalated',
    ]);
    expect(schema.properties.result.properties.commitSha.pattern).toBe('^[0-9a-f]{40}$');
  });
});
