import { describe, expect, it } from 'vitest';
import { decideCodexReviewRequest, reviewRequestMarker } from './codexReviewRequestPolicy';

const HEAD = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const TRUSTED_AUTHOR = 'delivery-engine';

function decide(overrides: Partial<Parameters<typeof decideCodexReviewRequest>[0]> = {}) {
  return decideCodexReviewRequest({
    currentHeadSha: HEAD,
    ciSha: HEAD,
    ciGreen: true,
    isDraft: false,
    trustedAuthors: [TRUSTED_AUTHOR],
    comments: [],
    ...overrides,
  });
}

describe('Codex review request policy', () => {
  it('requests one review only for a non-draft exact head with green exact-SHA CI', () => {
    expect(decide()).toEqual({ shouldRequest: true, marker: reviewRequestMarker(HEAD) });
    expect(decide({ isDraft: true })).toEqual({ shouldRequest: false, reason: 'draft' });
    expect(decide({ ciGreen: false })).toEqual({ shouldRequest: false, reason: 'ci-not-green' });
    expect(decide({ ciSha: OTHER_SHA })).toEqual({ shouldRequest: false, reason: 'ci-sha-mismatch' });
  });

  it('rejects malformed or abbreviated head SHAs', () => {
    expect(decide({ currentHeadSha: 'abc123' })).toEqual({
      shouldRequest: false,
      reason: 'invalid-head-sha',
    });
  });

  it('suppresses duplicates only for a trusted author with the request and exact marker paired', () => {
    const body = `@codex review\n\n${reviewRequestMarker(HEAD)}`;

    expect(
      decide({ comments: [{ author: TRUSTED_AUTHOR, body }] }),
    ).toEqual({ shouldRequest: false, reason: 'already-requested' });

    expect(
      decide({ comments: [{ author: 'untrusted-user', body }] }).shouldRequest,
    ).toBe(true);

    expect(
      decide({ comments: [{ author: TRUSTED_AUTHOR, body: reviewRequestMarker(HEAD) }] }).shouldRequest,
    ).toBe(true);

    expect(
      decide({ comments: [{ author: TRUSTED_AUTHOR, body: `@codex review\n\n${reviewRequestMarker(OTHER_SHA)}` }] }).shouldRequest,
    ).toBe(true);
  });

  it('requires a fresh request after remediation moves the head SHA', () => {
    const oldRequest = `@codex review\n\n${reviewRequestMarker(OTHER_SHA)}`;

    expect(
      decide({ comments: [{ author: TRUSTED_AUTHOR, body: oldRequest }] }),
    ).toEqual({ shouldRequest: true, marker: reviewRequestMarker(HEAD) });
  });
});
