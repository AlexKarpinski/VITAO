import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');

describe('Codex issue required-field admission policy', () => {
  it('accepts repository issue-form heading levels while requiring non-empty scoped content', () => {
    expect(workflow).toContain("const headingPattern = /^#{2,3}\\s+(.+?)\\s*$/;");
    expect(workflow).toContain("headings: ['goal', 'scope']");
    expect(workflow).toContain("headings: ['acceptance criteria']");
    expect(workflow).toContain("if (content.join('\\n').trim().length > 0)");
    expect(workflow).toContain('const missingRequiredSections = requiredSections');
    expect(workflow).toContain('if (missingRequiredSections.length > 0)');
    expect(workflow).toContain('Implementation was not started: issue scope is incomplete. Add required sections with content:');
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
