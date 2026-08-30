import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrusted = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
];

const normalizeExpression = (value: string) =>
  value
    .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1')
    .replace(/\s*\.\s*/g, '.')
    .trim();

const containsUntrustedExpression = (value: string) => {
  for (const match of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const expression = normalizeExpression(match[1]);
    if (untrusted.some((candidate) => expression.includes(candidate))) return true;
  }
  return false;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = match[2].trim();
    if (!/^[|>][0-9+-]*\s*(?:#.*)?$/.test(value)) {
      scripts.push(value);
      continue;
    }

    const block: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childTrimmed = childLine.trim();
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childTrimmed && childIndent <= indent) break;
      if (childTrimmed) block.push(childTrimmed);
      index = child;
    }
    scripts.push(block.join('\n'));
  }
  return scripts;
};

const expectNoWhitespaceObfuscatedUntrustedShell = (workflow: string, source: string) => {
  for (const script of collectRunScripts(workflow)) {
    expect(
      containsUntrustedExpression(script),
      `${source}: run step references untrusted GitHub text through whitespace-obfuscated dereference`,
    ).toBe(false);
  }
};

describe('GitHub workflow untrusted expression whitespace policy', () => {
  it('rejects whitespace around dot dereferences', () => {
    const unsafe = 'steps:\n  - run: echo "${{ github . event . comment . body }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects mixed bracket and whitespace dereferences', () => {
    const unsafe = 'steps:\n  - run: echo "${{ github [\'event\'] . issue [\'body\'] }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(unsafe, 'unsafe-brackets.yml')).toThrow();
  });

  it('allows unrelated spaced expressions', () => {
    const safe = 'steps:\n  - run: echo "${{ github . repository }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces the boundary across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoWhitespaceObfuscatedUntrustedShell(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
