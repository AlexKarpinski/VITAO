import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const remediationPrompt = readFileSync('.github/codex/remediate-review.md', 'utf8');

describe('Codex review revision safety policy', () => {
  it('binds findings and merge readiness to the exact reviewed SHA', () => {
    expect(remediationPrompt).toContain('Associate every finding with the SHA reviewed by the reviewer.');
    expect(remediationPrompt).toContain('Do not treat approval or review for an older SHA as valid for a newer revision.');
    expect(remediationPrompt).toContain('`reviewedSha` is the exact SHA actually reviewed.');
  });

  it('requires fresh CI and review after remediation changes the head', () => {
    expect(remediationPrompt).toContain('After any file change, push a new SHA, rerun required validation, and require a new review.');
    expect(remediationPrompt).toContain('Request at most one Codex review per exact SHA.');
    expect(remediationPrompt).toContain('`freshReviewRequired` is `true` after any remediation commit changes the PR head.');
  });

  it('requires a full exact-head marker on every Codex review request', () => {
    expect(remediationPrompt).toContain('<!-- codex-review-requested:<full-head-sha> -->');
    expect(remediationPrompt).toContain('using the full exact PR head SHA');
    expect(remediationPrompt).toContain('with a short SHA');
    expect(remediationPrompt).toContain('with a marker for a different revision');
  });
});
