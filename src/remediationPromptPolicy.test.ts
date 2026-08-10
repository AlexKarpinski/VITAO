import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prompt = readFileSync('.github/codex/remediate-review.md', 'utf8');
const schema = JSON.parse(
  readFileSync('.github/codex/remediation-record.schema.json', 'utf8'),
) as {
  required: string[];
};

describe('Codex remediation prompt contract', () => {
  it('requires one schema-conforming remediation record per handled finding', () => {
    expect(prompt).toContain('.github/codex/remediation-record.schema.json');
    expect(prompt).toContain('For every handled finding, emit one remediation decision record');

    for (const field of schema.required) {
      expect(prompt).toContain(`\`${field}\``);
    }
  });

  it('keeps verification tied to exact evidence and repository validation commands', () => {
    expect(prompt).toContain('.github/codex/validate.md');
    expect(prompt).toContain('exact verified SHA');
    expect(prompt).toContain('do not report skipped or unrun commands as passed');
    expect(prompt).toContain('`freshReviewRequired` is `true` after any remediation commit');
  });

  it('escalates missing evidence instead of allowing invented schema values', () => {
    expect(prompt).toContain('Do not invent placeholder values to satisfy the schema');
    expect(prompt).toContain('use an escalation decision');
  });
});
