import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');
const implementationPrompt = readFileSync('.github/codex/implement.md', 'utf8');
const issueTrigger = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');

describe('Codex implementation mutation policy', () => {
  it('requires one canonical deterministic issue branch across authoritative sources', () => {
    expect(implementationContract).toContain('deterministic branch prefix `codex/issue-<number>`');
    expect(implementationPrompt).toContain('canonical deterministic branch `codex/issue-<number>` for new issue branches');
    expect(issueTrigger).toContain('const branchName = `codex/issue-${issue.number}`;');
    expect(issueTrigger).toContain('use and reuse the canonical deterministic branch');
    expect(issueTrigger).not.toContain('beginning with');
  });

  it('preserves an existing legacy issue PR instead of creating a duplicate canonical branch', () => {
    expect(implementationPrompt).toContain('previous deterministic `codex/issue-<number>-<slug>` form');
    expect(implementationPrompt).toContain('continue that exact existing branch rather than creating or migrating to a duplicate branch');
  });

  it('requires deterministic issue branch and single PR reuse', () => {
    expect(implementationContract).toContain('an existing issue branch or PR is reused instead of duplicated');
    expect(implementationContract).toContain('Create at most one draft PR for the issue, or update the existing one.');
  });

  it('preserves existing branch commits and keeps merge authority in the Delivery Engine', () => {
    const forcePushBan = 'never force-push an existing issue branch; preserve owner-authored and prior successful Codex commits.';
    expect(implementationContract.toLowerCase()).toContain(forcePushBan);
    expect(implementationPrompt.toLowerCase()).toContain(forcePushBan);
    expect(implementationContract).toContain('Do not merge; Delivery Engine owns merge gating.');
  });
});
