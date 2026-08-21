import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type RuntimePolicy = {
  status: 'blocked-owner-input' | 'approved';
  policyVersion: number;
  model: string | null;
  maxTokensPerRun: number | null;
  maxCostUsdPerRun: number | null;
  downstreamTimeoutMinutes: number | null;
  notes: string;
};

const policy = JSON.parse(
  readFileSync('.github/codex/runtime-policy.json', 'utf8')
) as RuntimePolicy;
const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const ciFixTrigger = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');

describe('Codex runtime activation policy record', () => {
  it('keeps owner-controlled runtime limits explicit and versioned', () => {
    expect(policy.policyVersion).toBeGreaterThanOrEqual(1);
    expect(['blocked-owner-input', 'approved']).toContain(policy.status);
    expect(policy.notes).toContain('Owner-controlled activation inputs');
  });

  it('cannot be approved with missing or non-positive runtime controls', () => {
    if (policy.status !== 'approved') {
      expect(policy.status).toBe('blocked-owner-input');
      return;
    }

    expect(policy.model?.trim().length).toBeGreaterThan(0);
    expect(policy.maxTokensPerRun).toBeGreaterThan(0);
    expect(policy.maxCostUsdPerRun).toBeGreaterThan(0);
    expect(policy.downstreamTimeoutMinutes).toBeGreaterThan(0);
  });

  it('does not invent owner decisions while activation is blocked', () => {
    if (policy.status === 'blocked-owner-input') {
      expect(policy.model).toBeNull();
      expect(policy.maxTokensPerRun).toBeNull();
      expect(policy.maxCostUsdPerRun).toBeNull();
      expect(policy.downstreamTimeoutMinutes).toBeNull();
    }
  });

  it('keeps approval fail-closed until downstream execution actually consumes every recorded limit', () => {
    if (policy.status !== 'approved') {
      expect(policy.status).toBe('blocked-owner-input');
      return;
    }

    const downstreamRequests = `${issueTrigger}\n${ciFixTrigger}`;
    expect(downstreamRequests).toContain('policy.model');
    expect(downstreamRequests).toContain('policy.maxTokensPerRun');
    expect(downstreamRequests).toContain('policy.maxCostUsdPerRun');
    expect(downstreamRequests).toContain('policy.downstreamTimeoutMinutes');

    // Admission-time validation alone is not runtime enforcement. Approval is
    // allowed only after the request path carries these values into the worker
    // execution contract, so a plain status/value flip cannot activate an
    // unbounded downstream run while this repository still lacks that wiring.
    expect(downstreamRequests).toMatch(/Execution runtime policy|Downstream runtime policy/);
  });
});
