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

  it('keeps approval fail-closed until downstream execution enforcement is implemented', () => {
    // This repository currently validates runtime-policy values only at
    // admission time. That is not execution enforcement. Keep activation
    // unconditionally blocked until a separate implementation carries and
    // enforces model/token/cost/timeout controls in the downstream worker.
    // When that implementation lands, this assertion must be deliberately
    // replaced by behavioral coverage of the real execution contract.
    expect(policy.status).toBe('blocked-owner-input');
  });
});
