import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');

describe('Codex issue required-field admission policy', () => {
  it('requires scoped issue content before an implementation request can be emitted', () => {
    expect(workflow).toContain("name: 'Goal or Scope'");
    expect(workflow).toContain("pattern: /^##\\s+(?:Goal|Scope)\\s*$/im");
    expect(workflow).toContain("name: 'Acceptance criteria'");
    expect(workflow).toContain("pattern: /^##\\s+Acceptance criteria\\s*$/im");
    expect(workflow).toContain('const missingRequiredSections = requiredSections');
    expect(workflow).toContain('if (missingRequiredSections.length > 0)');
    expect(workflow).toContain('Implementation was not started: issue scope is incomplete. Add required sections:');
  });

  it('checks required fields after readiness but before duplicate-request lookup or request creation', () => {
    const readiness = workflow.indexOf('if (!labels.includes(readyLabel))');
    const requiredFields = workflow.indexOf('const requiredSections = [');
    const duplicateLookup = workflow.indexOf('const comments = await github.paginate');
    const requestCreation = workflow.lastIndexOf('await github.rest.issues.createComment({');

    expect(readiness).toBeGreaterThan(-1);
    expect(requiredFields).toBeGreaterThan(readiness);
    expect(duplicateLookup).toBeGreaterThan(requiredFields);
    expect(requestCreation).toBeGreaterThan(duplicateLookup);
  });

  it('does not weaken the existing readiness, trust, or worker-enable gates', () => {
    expect(workflow).toContain("github.event.comment.body == '/codex implement'");
    expect(workflow).toContain("github.event.comment.user.type == 'User'");
    expect(workflow).toContain('ready-for-codex');
    expect(workflow).toContain("process.env.CODEX_WORKER_ENABLED !== 'true'");
  });
});
