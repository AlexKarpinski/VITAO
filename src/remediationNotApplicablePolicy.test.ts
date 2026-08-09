import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type VerificationRule = {
  if?: {
    properties?: {
      verification?: {
        properties?: { status?: { const?: string } };
      };
    };
  };
  then?: {
    properties?: {
      verification?: {
        properties?: { commands?: { maxItems?: number } };
      };
    };
  };
};

type RemediationSchema = {
  allOf: VerificationRule[];
};

const schema = JSON.parse(
  readFileSync('.github/codex/remediation-record.schema.json', 'utf8'),
) as RemediationSchema;

describe('not-applicable remediation verification', () => {
  it('cannot claim command execution without an exact verified SHA', () => {
    expect(schema.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({
            properties: {
              verification: expect.objectContaining({
                properties: { status: { const: 'not-applicable' } },
              }),
            },
          }),
          then: {
            properties: {
              verification: {
                properties: {
                  commands: { maxItems: 0 },
                },
              },
            },
          },
        }),
      ]),
    );
  });
});
