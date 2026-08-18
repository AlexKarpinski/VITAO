import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const remediationPrompt = readFileSync('.github/codex/remediate-review.md', 'utf8');

describe('Codex remediation cycle policy', () => {
  it('caps automated remediation at three cycles and preserves blocking exceptions', () => {
    expect(remediationPrompt).toContain('Stop after three automated remediation cycles for one PR.');
    expect(remediationPrompt).toContain('After the third cycle, new non-blocking `MINOR` findings become follow-up candidates');
    expect(remediationPrompt).toContain('Security/privacy exposure, proven data loss, broken primary flow');
    expect(remediationPrompt).toContain('`BLOCKER`, and `MAJOR` findings remain blocking regardless of cycle count.');
  });

  it('requires a fresh exact-SHA review after remediation changes the head', () => {
    expect(remediationPrompt).toContain('After any file change, push a new SHA, rerun required validation, and require a new review.');
    expect(remediationPrompt).toContain('Request at most one Codex review per exact SHA.');
  });
});
