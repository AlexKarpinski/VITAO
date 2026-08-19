import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const implementationContract = readFileSync('.github/codex/implementation-request.schema.md', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('Codex Delivery Engine handoff policy', () => {
  it('records GitHub-owned evidence needed to reconcile a generated PR', () => {
    expect(implementationContract).toContain('## Delivery Engine handoff');
    expect(implementationContract).toContain('exact current PR head SHA and base branch');
    expect(implementationContract).toContain('draft/non-draft state');
    expect(implementationContract).toContain('required validation commands and their results for that exact head');
    expect(implementationContract).toContain('completed and remaining acceptance criteria');
    expect(implementationContract).toContain('owner-input or tooling blocker');
  });

  it('publishes every required validation command through exact-head CI', () => {
    expect(ciWorkflow).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');

    const installIndex = ciWorkflow.indexOf('run: npm ci');
    const testIndex = ciWorkflow.indexOf('run: npm test -- --run');
    const buildIndex = ciWorkflow.indexOf('run: npm run build');

    expect(installIndex).toBeGreaterThan(-1);
    expect(testIndex).toBeGreaterThan(installIndex);
    expect(buildIndex).toBeGreaterThan(testIndex);
    expect(ciWorkflow).not.toContain('run: npm install');
    expect(ciWorkflow).not.toContain('Check test script');
    expect(ciWorkflow).not.toContain("steps.test-script.outputs.exists == 'true'");
  });

  it('forbids non-GitHub-only handoff evidence', () => {
    expect(implementationContract).toContain('Do not rely on local workspace state, unpushed commits, hidden runner files, or prose-only status comments as handoff evidence.');
    expect(implementationContract).toContain('The Delivery Engine must be able to continue CI, review, remediation, and merge-gate reconciliation using GitHub issue/PR state and exact-SHA evidence.');
  });
});
