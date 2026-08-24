import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeGitHubExpressionAccess = (value: string) =>
  value.replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const stripYamlInlineComment = (value: string) => value.replace(/\s+#.*$/, '').trim();

const extractRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s*)?run\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = stripYamlInlineComment(match[2]);
    if (value && !/^[|>](?:[+-]?\d|\d[+-]?)?$/.test(value)) {
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

const untrustedTextExpressions = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
];

const containsUntrustedExpression = (value: string) => {
  const normalized = normalizeGitHubExpressionAccess(value);
  return untrustedTextExpressions.some((expression) => normalized.includes(expression));
};

const extractUntrustedEnvVars = (workflow: string) => {
  const vars = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) continue;
    if (containsUntrustedExpression(match[2])) vars.add(match[1]);
  }
  return vars;
};

const scriptReferencesVariable = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?::[-+?=][^}]*)?\\})`).test(script);
};

const expectNoUntrustedTextInShell = (workflow: string, source: string) => {
  const untrustedEnvVars = extractUntrustedEnvVars(workflow);

  for (const script of extractRunScripts(workflow)) {
    expect(containsUntrustedExpression(script), `${source}: run step directly references untrusted event text`).toBe(false);

    for (const envVar of untrustedEnvVars) {
      expect(
        scriptReferencesVariable(script, envVar),
        `${source}: run step executes untrusted event text through env ${envVar}`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow untrusted shell policy', () => {
  it('never interpolates issue, PR, comment, or review text into shell run steps', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectNoUntrustedTextInShell(workflow, workflowFile);
    }
  });

  it('checks inline and block run steps while allowing non-shell GitHub Script usage', () => {
    const safe = [
      'steps:',
      '  - run: npm test -- --run',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      '        const body = context.payload.comment?.body;',
    ].join('\n');

    expectNoUntrustedTextInShell(safe, 'safe.yml');
    expect(extractRunScripts(safe)).toEqual(['npm test -- --run']);
  });

  it('rejects direct dot and bracket access to untrusted event text', () => {
    const unsafeWorkflows = [
      'steps:\n  - run: echo "${{ github.event.comment.body }}"',
      'steps:\n  - run: echo "${{ github.event.comment[\'body\'] }}"',
      'steps:\n  - run: echo "${{ github[\'event\'][\'issue\'][\'body\'] }}"',
    ];

    for (const workflow of unsafeWorkflows) {
      expect(() => expectNoUntrustedTextInShell(workflow, 'unsafe.yml')).toThrow();
    }
  });

  it('rejects untrusted text routed through environment variables into shell commands', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'env-unsafe.yml')).toThrow();
  });

  it('parses commented YAML block-scalar run headers', () => {
    const unsafe = [
      'steps:',
      '  - run: | # execute validation',
      '      printf "%s" "${{ github.event.issue.body }}"',
    ].join('\n');

    expect(extractRunScripts(unsafe)).toEqual(['printf "%s" "${{ github.event.issue.body }}"']);
    expect(() => expectNoUntrustedTextInShell(unsafe, 'commented-block.yml')).toThrow();
  });
});
