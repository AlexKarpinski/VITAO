import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex implementation mutation policy', () => {
  it('requires deterministic issue branch and single PR reuse', () => {
    expect(implementationContract).toContain('deterministic branch prefix `codex/issue-<number>`');
    expect(implementationContract).toContain('an existing issue branch or PR is reused instead of duplicated');
    expect(implementationContract).toContain('Create at most one draft PR for the issue, or update the existing one.');
  });

  it('preserves owner changes and keeps merge authority in the Delivery Engine', () => {
    expect(implementationContract).toContain('Never force-push over owner changes.');
    expect(implementationContract).toContain('Do not merge; Delivery Engine owns merge gating.');
  });
});
