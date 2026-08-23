import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const usesKeyPattern =
  /(?:^|[\s{,])(?:-\s*)?["']?uses["']?\s*:\s*(?:"([^"]+)"|'([^']+)'|([^\s,}\]#]+))/gm;

const extractActionRefs = (workflow: string) =>
  [...workflow.matchAll(usesKeyPattern)].map((match) => match[1] ?? match[2] ?? match[3]);

const expectImmutableExternalActions = (workflow: string, source: string) => {
  for (const actionRef of extractActionRefs(workflow)) {
    if (actionRef.startsWith('./')) continue;
    expect(actionRef, `${source}: ${actionRef}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('GitHub workflow action pinning policy', () => {
  it('pins every external action in every workflow to an immutable full commit SHA', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectImmutableExternalActions(workflow, workflowFile);
    }
  });

  it('accounts for quoted and flow-style YAML uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const workflow = [
      `- { name: Checkout, uses: actions/checkout@${sha} }`,
      `- 'uses': 'actions/setup-node@${sha}'`,
      `- "uses": "actions/upload-artifact@${sha}"`,
      '- uses: ./local-action',
    ].join('\n');

    expect(extractActionRefs(workflow)).toEqual([
      `actions/checkout@${sha}`,
      `actions/setup-node@${sha}`,
      `actions/upload-artifact@${sha}`,
      './local-action',
    ]);
    expectImmutableExternalActions(workflow, 'synthetic-workflow.yml');
  });

  it('rejects mutable tags in non-canonical YAML forms', () => {
    for (const workflow of [
      '- { name: Checkout, uses: actions/checkout@v4 }',
      "- 'uses': actions/setup-node@v4",
      '- "uses": "actions/upload-artifact@v4"',
    ]) {
      expect(() => expectImmutableExternalActions(workflow, 'synthetic-workflow.yml')).toThrow();
    }
  });
});
