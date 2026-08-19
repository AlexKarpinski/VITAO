import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('.github/codex/README.md', 'utf8');

describe('Codex runtime operations policy', () => {
  it('keeps the worker inactive until owner-controlled runtime decisions are documented', () => {
    expect(readme).toContain('These files are **inactive groundwork only**.');
    expect(readme).toContain('OpenAI/Codex credential, model, token, and API-budget strategy');
    expect(readme).toContain('retry and manual-cancellation behavior');
    expect(readme).toContain('branch-protection and merge policy');
  });

  it('bounds trigger execution without pretending that it bounds downstream API spend', () => {
    expect(readme).toContain('`.github/workflows/codex-issue-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('`.github/workflows/codex-ci-fix-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('they are not approval for an unbounded downstream implementation/remediation process');
    expect(readme).toContain('Model choice, token/cost limits, retry policy, and operator cancellation behavior must be explicitly documented before the worker is enabled.');
  });
});
