import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type MergePolicy = {
  policyVersion: number;
  status: 'blocked-owner-input' | 'approved';
  defaultBranch: string;
  requiredMergeMethod: 'squash';
  requireProtectedDefaultBranch: boolean;
  requireRequiredStatusChecks: boolean;
  requireCurrentShaReview: boolean;
  branchProtectionConfirmed: boolean | null;
  requiredStatusChecksConfirmed: boolean | null;
  requiredReviewPolicyConfirmed: boolean | null;
  notes: string;
};

const policy = JSON.parse(
  readFileSync('.github/codex/merge-policy.json', 'utf8')
) as MergePolicy;

describe('Codex merge policy record', () => {
  it('keeps merge policy explicit and versioned', () => {
    expect(policy.policyVersion).toBeGreaterThanOrEqual(1);
    expect(policy.defaultBranch).toBe('main');
    expect(policy.requiredMergeMethod).toBe('squash');
    expect(policy.requireProtectedDefaultBranch).toBe(true);
    expect(policy.requireRequiredStatusChecks).toBe(true);
    expect(policy.requireCurrentShaReview).toBe(true);
  });

  it('cannot be approved without verified GitHub merge protections', () => {
    if (policy.status !== 'approved') {
      expect(policy.status).toBe('blocked-owner-input');
      return;
    }

    expect(policy.branchProtectionConfirmed).toBe(true);
    expect(policy.requiredStatusChecksConfirmed).toBe(true);
    expect(policy.requiredReviewPolicyConfirmed).toBe(true);
  });

  it('does not invent owner-controlled protection decisions while blocked', () => {
    if (policy.status === 'blocked-owner-input') {
      expect(policy.branchProtectionConfirmed).toBeNull();
      expect(policy.requiredStatusChecksConfirmed).toBeNull();
      expect(policy.requiredReviewPolicyConfirmed).toBeNull();
    }
  });

  it('keeps autonomous merge fail-closed until policy is explicitly verified', () => {
    expect(policy.status).toBe('blocked-owner-input');
    expect(policy.notes).toContain('Owner-controlled merge-policy inputs');
  });
});
