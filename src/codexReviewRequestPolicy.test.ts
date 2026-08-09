import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contract = readFileSync('.github/codex/review-request.md', 'utf8');

describe('Codex review request contract', () => {
  it('requires the exact-SHA hidden marker in the review request', () => {
    expect(contract).toContain('@codex review');
    expect(contract).toContain('<!-- codex-review-requested:<full-head-sha> -->');
    expect(contract).toContain('40-character lowercase hexadecimal PR head SHA');
  });

  it('prevents duplicate review requests for the same head SHA', () => {
    expect(contract).toContain('No review request has already been issued for the same exact head SHA');
    expect(contract).toContain('If that exact marker already exists, do not request another review for that SHA');
  });

  it('requires fresh green CI and review after a remediation commit', () => {
    expect(contract).toContain('Required CI is green for the exact current PR head SHA');
    expect(contract).toContain('A remediation commit changes the head SHA and invalidates older review readiness');
    expect(contract).toContain('Request a new review only after required CI succeeds for the new exact head SHA');
    expect(contract).toContain('Reviews for older SHAs must never authorize merging a newer revision');
  });
});
