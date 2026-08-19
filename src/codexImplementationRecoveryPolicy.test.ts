import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex implementation recovery policy', () => {
  it('keeps failed runs recoverable without destructive branch mutation', () => {
    expect(implementationContract).toContain(
      'Never force-push an existing issue branch; preserve owner-authored and prior successful Codex commits.',
    );
    expect(implementationContract).toContain('Create at most one draft PR for the issue, or update the existing one.');
    expect(implementationContract).toContain('Push successful commits to the deterministic issue branch.');
  });

  it('requires an explicit terminal result for every admitted run', () => {
    for (const result of [
      'success',
      'precondition-failed',
      'validation-failed',
      'blocked-owner',
      'blocked-tooling',
      'no-safe-slice',
    ]) {
      expect(implementationContract).toContain(`\`${result}\``);
    }
  });

  it('records enough evidence to continue safely without exposing secrets', () => {
    expect(implementationContract).toContain('base SHA and resulting head SHA');
    expect(implementationContract).toContain('branch and PR URL when present');
    expect(implementationContract).toContain('changed files');
    expect(implementationContract).toContain('validation commands and results');
    expect(implementationContract).toContain('Do not include secrets, raw credentials, private tokens, or unnecessary raw logs');
  });
});
