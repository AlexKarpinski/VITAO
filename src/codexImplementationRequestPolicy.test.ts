import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const trigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
const contract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex implementation request trust boundary', () => {
  it('records verifiable admission provenance in the trusted trigger request', () => {
    expect(trigger).toContain('command comment ID:');
    expect(trigger).toContain('${commandComment.id}');
    expect(trigger).toContain('workflow run ID:');
    expect(trigger).toContain('${context.runId}');
    expect(trigger).toContain('admitted actor:');
  });

  it('pins the repository-owned contract to the same base revision as the worker prompts', () => {
    expect(contract).toContain('`.github/codex/implementation-request.schema.md` loaded from that exact base revision');
    expect(contract).toContain('recorded command comment and workflow-run provenance against GitHub');
  });
});
