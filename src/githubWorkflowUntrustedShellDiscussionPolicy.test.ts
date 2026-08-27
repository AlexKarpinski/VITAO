import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeExpressionAccess = (value: string) => value
  .replace(/\?\.\s*\[/g, '[')
  .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
  .replace(/\?\./g, '.');

const containsUntrustedDiscussionText = (value: string) => {
  const normalized = normalizeExpressionAccess(value);
  return [
    'github.event.discussion.title',
    'github.event.discussion.body',
    'context.payload.discussion.title',
    'context.payload.discussion.body',
  ].some((source) => normalized.includes(source))
    || /tojson\s*\(\s*github\.event\.discussion\s*\)/i.test(normalized);
};

const collectRunLikeScalars = (workflow: string) => workflow
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^(?:-\s*)?(?:["']?run["']?|["']?shell["']?)\s*:/.test(line));

const assertDiscussionTextDoesNotCrossShellBoundary = (workflow: string) => {
  for (const scalar of collectRunLikeScalars(workflow)) {
    expect(containsUntrustedDiscussionText(scalar)).toBe(false);
  }
};

describe('GitHub workflow discussion-text shell boundary policy', () => {
  it('protects checked-in workflows', () => {
    for (const name of workflowFiles) {
      assertDiscussionTextDoesNotCrossShellBoundary(
        readFileSync(join(workflowsDir, name), 'utf8'),
      );
    }
  });

  it('rejects direct discussion body interpolation into run', () => {
    const unsafe = [
      'on: discussion',
      'jobs:',
      '  validate:',
      '    steps:',
      `      - run: bash -c '\${{ github.event.discussion.body }}'`,
    ].join('\n');
    expect(() => assertDiscussionTextDoesNotCrossShellBoundary(unsafe)).toThrow();
  });

  it('rejects bracket and optional-chain discussion access', () => {
    const unsafe = [
      'jobs:',
      '  validate:',
      '    steps:',
      `      - shell: bash -c '\${{ github.event.discussion?.['body'] }}' -- {0}`,
      '        run: echo safe',
    ].join('\n');
    expect(() => assertDiscussionTextDoesNotCrossShellBoundary(unsafe)).toThrow();
  });

  it('rejects serialized discussion objects', () => {
    const unsafe = [
      'jobs:',
      '  validate:',
      '    steps:',
      `      - run: bash -c '\${{ toJson(github.event.discussion) }}'`,
    ].join('\n');
    expect(() => assertDiscussionTextDoesNotCrossShellBoundary(unsafe)).toThrow();
  });

  it('allows discussion text in non-shell github-script data handling', () => {
    const safe = [
      'jobs:',
      '  validate:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.discussion.body)',
    ].join('\n');
    expect(() => assertDiscussionTextDoesNotCrossShellBoundary(safe)).not.toThrow();
  });
});
