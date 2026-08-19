import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const remediationPrompt = readFileSync('.github/codex/remediate-review.md', 'utf8');

describe('Codex review finding classification policy', () => {
  it('keeps the approved finding class definitions explicit', () => {
    const definitions = [
      '`BLOCKER`: credential/security/privacy exposure, proven data loss, broken deployment, or broken primary user flow.',
      '`MAJOR`: direct acceptance-criteria failure, meaningful functional regression, accessibility barrier, or incorrect localization behavior.',
      '`MINOR`: low-risk edge case, maintainability, test clarity, styling, copy, or non-blocking accessibility improvement.',
      '`QUESTION`: insufficient evidence or conflicting expected behavior.',
      '`NON_ACTIONABLE`: outdated, duplicate, incorrect, preference-only, or outside approved scope.',
    ];

    for (const definition of definitions) {
      expect(remediationPrompt).toContain(definition);
    }
  });

  it('keeps blocking review conditions explicit', () => {
    expect(remediationPrompt).toContain('`BLOCKER` and `MAJOR` always block merge.');
    expect(remediationPrompt).toContain(
      'A `MINOR` blocks only when it directly violates approved acceptance criteria, carries a formal active `REQUEST_CHANGES`, or demonstrates security/privacy exposure, proven data loss, or a broken primary flow.',
    );
  });

  it('protects every evidence gate as a required condition for safe automatic remediation', () => {
    expect(remediationPrompt).toContain('A finding may be fixed automatically only when:');

    const evidenceGates = [
      'expected behavior is unambiguous;',
      'the change is inside the approved issue/PR scope;',
      'required source files and tests are available;',
      'no owner decision, production secret, binary asset, product fact, legal claim, or real-world evidence must be invented;',
      'the fix does not introduce unrelated architecture or dependencies.',
    ];

    for (const gate of evidenceGates) {
      expect(remediationPrompt).toContain(gate);
    }

    expect(remediationPrompt).toContain('If required evidence is unavailable, use an escalation decision');
  });
});
