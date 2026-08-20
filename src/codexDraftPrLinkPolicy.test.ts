import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const implementationContract = readFileSync(
  '.github/codex/implementation-request.schema.md',
  'utf8'
);

describe('Codex draft PR and issue-link policy', () => {
  it('requires reuse and at most one draft PR per issue', () => {
    expect(implementationContract).toContain(
      'an existing issue branch or PR is reused instead of duplicated'
    );
    expect(implementationContract).toContain(
      'Create at most one draft PR for the issue, or update the existing one.'
    );
  });

  it('links the PR without falsely closing partially completed issue scope', () => {
    expect(implementationContract).toContain(
      'Use `Refs #<number>` unless the implementation completes the whole issue and can legitimately use `Closes #<number>`.'
    );
  });

  it('keeps merge authority with the Delivery Engine', () => {
    expect(implementationContract).toContain(
      'Do not merge; Delivery Engine owns merge gating.'
    );
  });
});
