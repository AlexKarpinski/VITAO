import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');

describe('Codex branch drift recovery policy', () => {
  it('detects drift before mutating an existing issue branch', () => {
    expect(contract).toContain('compare its head and merge-base with current `main`');
    expect(contract).toContain('detect branch drift or merge conflicts');
  });

  it('preserves unsafe divergent branches and escalates with evidence', () => {
    expect(contract).toContain('Do not automatically rebase, reset, or rewrite a branch');
    expect(contract).toContain('owner-authored commits, divergent history, or unresolved conflicts');
    expect(contract).toContain('preserve the branch and emit `blocked-owner` or `blocked-tooling`');
    expect(contract).toContain('exact drift/conflict evidence');
    expect(contract).toContain('Never force-push an existing issue branch');
  });
});
