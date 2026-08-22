import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type CollaboratorPolicy = {
  policyVersion: number;
  status: 'blocked-owner-input' | 'approved';
  repositoryOwnerMayTrigger: boolean;
  allowedCollaboratorLogins: string[];
  notes: string;
};

const policy = JSON.parse(
  readFileSync('.github/codex/collaborator-policy.json', 'utf8')
) as CollaboratorPolicy;

describe('Codex collaborator authorization policy', () => {
  it('keeps collaborator authorization explicit and versioned', () => {
    expect(policy.policyVersion).toBeGreaterThanOrEqual(1);
    expect(policy.repositoryOwnerMayTrigger).toBe(true);
    expect(Array.isArray(policy.allowedCollaboratorLogins)).toBe(true);
  });

  it('does not invent collaborator authorization while owner input is missing', () => {
    if (policy.status === 'blocked-owner-input') {
      expect(policy.allowedCollaboratorLogins).toEqual([]);
      expect(policy.notes).toContain('Owner-controlled collaborator authorization');
      return;
    }

    expect(policy.status).toBe('approved');
    expect(policy.allowedCollaboratorLogins.length).toBeGreaterThan(0);
    for (const login of policy.allowedCollaboratorLogins) {
      expect(login.trim()).toBe(login);
      expect(login.length).toBeGreaterThan(0);
    }
  });

  it('keeps collaborator admission fail-closed until the workflow enforces exact logins', () => {
    // The current admission workflow still trusts author_association for MEMBER/COLLABORATOR
    // and does not consume this policy. Approval must therefore remain impossible until a
    // separate implementation wires this allowlist into the production admission path.
    expect(policy.status).toBe('blocked-owner-input');
    expect(policy.allowedCollaboratorLogins).toEqual([]);
  });
});
