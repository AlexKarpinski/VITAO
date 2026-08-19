import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync('.github/codex/README.md', 'utf8');
const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const ciFixTrigger = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');
const triggerWorkflows = [issueTrigger, ciFixTrigger];

describe('Codex runtime operations policy', () => {
  it('keeps the worker inactive until owner-controlled runtime decisions are documented', () => {
    expect(readme).toContain('These files are **inactive groundwork only**.');
    expect(readme).toContain('OpenAI/Codex credential, model, token, and API-budget strategy');
    expect(readme).toContain('retry and manual-cancellation behavior');
    expect(readme).toContain('branch-protection and merge policy');

    for (const workflow of triggerWorkflows) {
      expect(workflow).not.toContain('actions/checkout@');
      expect(workflow).not.toContain('OPENAI_API_KEY');
      expect(workflow).not.toContain('CODEX_API_KEY');
      expect(workflow).not.toContain('openai/codex');
      expect(workflow).not.toContain('codex exec');
      expect(workflow).not.toContain('workspace-write');
      expect(workflow).not.toContain('contents: write');
    }
  });

  it('bounds trigger execution without pretending that it bounds downstream API spend', () => {
    expect(readme).toContain('`.github/workflows/codex-issue-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('`.github/workflows/codex-ci-fix-trigger.yml` uses `timeout-minutes: 5`.');
    expect(readme).toContain('they are not approval for an unbounded downstream implementation/remediation process');
    expect(readme).toContain('Model choice, token/cost limits, retry policy, and operator cancellation behavior must be explicitly documented before the worker is enabled.');
  });
});
