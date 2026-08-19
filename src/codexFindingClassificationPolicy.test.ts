import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const remediationPrompt = readFileSync('.github/codex/remediate-review.md', 'utf8');

describe('Codex review finding classification policy', () => {
  it('keeps the approved finding classes explicit', () => {
    for (const severity of ['BLOCKER', 'MAJOR', 'MINOR', 'QUESTION', 'NON_ACTIONABLE']) {
      expect(remediationPrompt).toContain(`\`${severity}\``);
    }
  });

  it('keeps blocking review conditions explicit', () => {
    expect(remediationPrompt).toContain('`BLOCKER` and `MAJOR` always block merge.');
    expect(remediationPrompt).toContain('directly violates approved acceptance criteria');
    expect(remediationPrompt).toContain('formal active `REQUEST_CHANGES`');
    expect(remediationPrompt).toContain('security/privacy exposure');
    expect(remediationPrompt).toContain('proven data loss');
    expect(remediationPrompt).toContain('broken primary flow');
  });

  it('requires evidence instead of blindly implementing reviewer suggestions', () => {
    expect(remediationPrompt).toContain('insufficient evidence or conflicting expected behavior');
    expect(remediationPrompt).toContain('outdated, duplicate, incorrect, preference-only, or outside approved scope');
    expect(remediationPrompt).toContain('If required evidence is unavailable, use an escalation decision');
  });
});
