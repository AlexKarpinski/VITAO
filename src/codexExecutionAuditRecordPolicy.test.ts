import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex implementation execution audit record', () => {
  it('records the workflow, execution configuration, timestamps, and terminal result', () => {
    expect(contract).toContain('workflow run ID and workflow name');
    expect(contract).toContain('exact model identifier and repository-owned configuration identifier actually used for the run');
    expect(contract).toContain('record them as `not-started` rather than inventing values');
    expect(contract).toContain('start and end timestamps for the implementation attempt');
    expect(contract).toContain('terminal result (`success`, `precondition-failed`, `validation-failed`, `blocked-owner`, `blocked-tooling`, `no-safe-slice`, or `cancelled`)');
    expect(contract).toContain('A `cancelled` result is valid only when the corresponding GitHub Actions run is observably cancelled');
  });

  it('keeps owner-controlled activation inputs separate from execution evidence', () => {
    expect(contract).toContain('Model choice, credentials, token limits, and API/cost budgets remain owner-controlled activation inputs');
    expect(contract).toContain('Recording execution evidence does not authorize or invent those values');
    expect(contract).toContain('Do not include secrets, raw credentials, private tokens, or unnecessary raw logs in the record');
  });
});
