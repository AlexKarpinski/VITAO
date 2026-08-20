import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');

describe('Codex issue required-field admission policy', () => {
  it('accepts repository issue-form heading levels while requiring visible scoped content', () => {
    expect(workflow).toContain("const headingPattern = /^#{2,3}\\s+(.+?)\\s*$/;");
    expect(workflow).toContain("headings: ['goal', 'scope']");
    expect(workflow).toContain("headings: ['acceptance criteria']");
    expect(workflow).toContain(".filter((line) => !/^\\s{0,3}(?:`{3,}|~{3,})/.test(line))");
    expect(workflow).toContain('if (visibleContent.length > 0)');
    expect(workflow).toContain('const missingRequiredSections = requiredSections');
    expect(workflow).toContain('if (missingRequiredSections.length > 0)');
    expect(workflow).toContain('Implementation was not started: issue scope is incomplete. Add required sections with content:');
  });

  it('ignores headings hidden by comments while preserving literal comment examples inside fences', () => {
    expect(workflow).toContain('let inHtmlComment = false;');
    expect(workflow).toContain("const open = line.indexOf('<!--', cursor);");
    expect(workflow).toContain("const close = line.indexOf('-->', cursor);");
    expect(workflow).toContain('const commentStrippedLines = issueLines.map((line) =>');
    expect(workflow).toContain('if (activeFence !== null)');
    expect(workflow).toContain('return line;');
    expect(workflow).toContain("const normalizeHeading = (heading) => heading.replace(/\\s+#+\\s*$/, '').trim().toLowerCase();");
    expect(workflow).toContain('const headingAt = (index) => fencedLines[index] ? null : (() => {');
    expect(workflow).toContain('return heading ? normalizeHeading(heading) : null;');
  });

  it('keeps fenced regions active until a valid same-marker closing fence of sufficient length', () => {
    expect(workflow).toContain('activeFence = { marker: openingFence[0], length: openingFence.length };');
    expect(workflow).toContain('closingFence[0] === activeFence.marker && closingFence.length >= activeFence.length');
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
