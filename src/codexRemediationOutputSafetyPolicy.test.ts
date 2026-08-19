import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const remediationPrompt = readFileSync('.github/codex/remediate-review.md', 'utf8');
const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex remediation output safety policy', () => {
  it('forbids leaking sensitive values or unnecessary raw logs in remediation output', () => {
    expect(remediationPrompt).toContain(
      'Never include secrets, credentials, tokens, environment values, or unnecessary raw logs in remediation records, PR comments, or review replies.',
    );
    expect(implementationContract).toContain(
      'Do not include secrets, raw credentials, private tokens, or unnecessary raw logs in the record.',
    );
  });

  it('requires escalation rather than inventing protected or owner-controlled inputs', () => {
    expect(remediationPrompt).toContain(
      'contact details, provider credentials, owner access, pricing inputs, physical measurements, production data, or user feedback',
    );
    expect(remediationPrompt).toContain(
      'If required evidence is unavailable, use an escalation decision rather than claiming a successful fix or verification.',
    );
  });
});
