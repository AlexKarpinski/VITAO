import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const ciFixTrigger = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');

describe('Codex trigger workflow timeouts', () => {
  it('bounds both trigger jobs so they cannot run indefinitely', () => {
    expect(issueTrigger).toContain('timeout-minutes: 5');
    expect(ciFixTrigger).toContain('timeout-minutes: 5');
  });
});
