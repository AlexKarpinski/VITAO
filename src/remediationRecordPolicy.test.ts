import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type ConditionalRequirement = {
  if: {
    properties: {
      status: { const: string };
    };
    required: string[];
  };
  then: { required: string[] };
};

type FixedVerificationRequirement = {
  if: {
    properties: {
      result: {
        properties: { status: { const: string } };
        required: string[];
      };
    };
    required: string[];
  };
  then: {
    properties: {
      verification: {
        properties: {
          status: { const: string };
          commands: {
            minItems: number;
            items: {
              properties: { status: { const: string } };
              required: string[];
            };
          };
        };
        required: string[];
      };
    };
  };
};

type RemediationSchema = {
  additionalProperties: boolean;
  required: string[];
  allOf: FixedVerificationRequirement[];
  properties: {
    reviewedSha: { pattern: string };
    severity: { enum: string[] };
    target: { required: string[] };
    evidence: { minLength: number };
    decision: {
      required: string[];
      properties: { action: { enum: string[] } };
    };
    changedFiles: {
      type: string;
      items: { type: string; minLength: number };
      uniqueItems: boolean;
    };
    verification: {
      required: string[];
      properties: {
        status: { enum: string[] };
        verifiedSha: { pattern: string; description: string };
        commands: {
          minItems?: number;
          items: {
            required: string[];
            properties: { status: { enum: string[] } };
          };
        };
      };
    };
    threadResolution: {
      required: string[];
      properties: { canResolve: { type: string }; reason: { minLength: number } };
    };
    freshReviewRequired: { type: string };
    automation: { required: string[] };
    result: {
      required: string[];
      properties: {
        status: { enum: string[] };
        commitSha: { pattern: string };
        escalation: { minLength: number };
      };
      allOf: ConditionalRequirement[];
    };
  };
};

const schema = JSON.parse(
  readFileSync('.github/codex/remediation-record.schema.json', 'utf8'),
) as RemediationSchema;

describe('Codex remediation decision record contract', () => {
  it('requires the evidence needed to tie a finding to one reviewed revision', () => {
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([
      'source',
      'reviewedSha',
      'severity',
      'target',
      'evidence',
      'decision',
      'changedFiles',
      'verification',
      'threadResolution',
      'freshReviewRequired',
      'automation',
      'result',
    ]);
    expect(schema.properties.reviewedSha.pattern).toBe('^[0-9a-f]{40}$');
  });

  it('keeps finding classification aligned with Issue #37', () => {
    expect(schema.properties.severity.enum).toEqual([
      'BLOCKER',
      'MAJOR',
      'MINOR',
      'QUESTION',
      'NON_ACTIONABLE',
    ]);
  });

  it('records every outcome required by the remediation response contract', () => {
    expect(schema.properties.target.required).toContain('summary');
    expect(schema.properties.evidence.minLength).toBe(1);
    expect(schema.properties.decision.required).toEqual(['action', 'reason']);
    expect(schema.properties.decision.properties.action.enum).toEqual([
      'fix',
      'challenge',
      'defer',
      'escalate',
    ]);
    expect(schema.properties.changedFiles).toMatchObject({
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    });
    expect(schema.properties.verification.required).toEqual(['method', 'status', 'commands']);
    expect(schema.properties.verification.properties.status.enum).toContain('not-applicable');
    expect(schema.properties.verification.properties.verifiedSha.pattern).toBe(
      '^[0-9a-f]{40}$',
    );
    expect(schema.properties.verification.properties.commands).toMatchObject({
      items: {
        required: ['command', 'status'],
        properties: {
          status: { enum: ['pending', 'passed', 'failed'] },
        },
      },
    });
    expect(schema.properties.verification.properties.commands.minItems).toBeUndefined();
    expect(schema.properties.threadResolution.required).toEqual(['canResolve', 'reason']);
    expect(schema.properties.threadResolution.properties.canResolve.type).toBe('boolean');
    expect(schema.properties.freshReviewRequired.type).toBe('boolean');
    expect(schema.properties.automation.required).toEqual(['eligible', 'reason']);
  });

  it('requires traceable evidence for terminal fixed and escalated results', () => {
    expect(schema.properties.result.required).toEqual(['status']);
    expect(schema.properties.result.properties.status.enum).toEqual([
      'pending',
      'fixed',
      'challenged',
      'deferred',
      'escalated',
    ]);
    expect(schema.properties.result.properties.commitSha.pattern).toBe('^[0-9a-f]{40}$');

    expect(schema.properties.result.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({
            properties: { status: { const: 'fixed' } },
          }),
          then: { required: ['commitSha'] },
        }),
        expect.objectContaining({
          if: expect.objectContaining({
            properties: { status: { const: 'escalated' } },
          }),
          then: { required: ['escalation'] },
        }),
      ]),
    );
  });

  it('binds fixed results to successful exact-head verification evidence', () => {
    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({
            properties: {
              result: expect.objectContaining({
                properties: { status: { const: 'fixed' } },
              }),
            },
          }),
          then: {
            properties: {
              verification: {
                properties: {
                  status: { const: 'passed' },
                  commands: {
                    minItems: 1,
                    items: {
                      properties: { status: { const: 'passed' } },
                      required: ['status'],
                    },
                  },
                },
                required: ['verifiedSha', 'commands', 'status'],
              },
            },
          },
        }),
      ]),
    );
    expect(schema.properties.verification.properties.verifiedSha.description).toContain(
      'result.commitSha',
    );
  });

  it('allows challenge, defer, or escalation without fabricated verification evidence', () => {
    expect(schema.properties.verification.required).not.toContain('verifiedSha');
    expect(schema.properties.verification.properties.commands.minItems).toBeUndefined();
    expect(schema.properties.verification.properties.status.enum).toContain('not-applicable');
  });
});
