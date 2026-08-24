import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const extractRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s*)?run\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = match[2].trim();
    if (value && !/^[|>][+-]?\d*$/.test(value)) {
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

const expectNoUntrustedTextInShell = (workflow: string, source: string) => {
  for (const script of extractRunScripts(workflow)) {
    for (const expression of untrustedTextExpressions) {
      expect(script, `${source}: run step references untrusted ${expression}`).not.toContain(expression);
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

  it('rejects untrusted event text in inline and block shell commands', () => {
    const unsafeWorkflows = [
      'steps:\n  - run: echo "${{ github.event.comment.body }}"',
      'steps:\n  - run: |\n      printf "%s" "${{ github.event.issue.body }}"',
      'steps:\n  - run: >-\n      echo "${{ github.event.pull_request.title }}"',
    ];

    for (const workflow of unsafeWorkflows) {
      expect(() => expectNoUntrustedTextInShell(workflow, 'unsafe.yml')).toThrow();
    }
  });
});
