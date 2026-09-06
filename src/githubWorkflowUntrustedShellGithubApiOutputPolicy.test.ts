import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const apiTextEndpoint = String.raw`github\.rest\.(?:issues\.(?:get|getComment)|pulls\.(?:get|getReview|getReviewComment))\s*\(`;
const apiTextEndpointPattern = new RegExp(apiTextEndpoint);

const collectStepBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+/);
    if (!start) continue;
    const indent = start[1].length;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      const trimmed = line.trim();
      const childIndent = line.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && childIndent === indent && /^\s*-\s+/.test(line)) break;
      if (trimmed && childIndent < indent) break;
      block.push(line);
      index = child;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

const returnsGithubApiText = (step: string) => {
  if (!apiTextEndpointPattern.test(step)) return false;

  const responseAliases = new Set<string>();
  const dataAliases = new Set<string>();
  const responseAssignment = new RegExp(
    String.raw`\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+${apiTextEndpoint}`,
    'g',
  );
  for (const match of step.matchAll(responseAssignment)) responseAliases.add(match[1]);

  const dataAssignment = new RegExp(
    String.raw`\bconst\s*\{\s*data(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?\s*\}\s*=\s*await\s+${apiTextEndpoint}`,
    'g',
  );
  for (const match of step.matchAll(dataAssignment)) dataAliases.add(match[1] ?? 'data');

  return step.split('\n').some((line) => {
    const returned = line.match(/\breturn\s+(.+?);?\s*$/)?.[1];
    if (!returned) return false;
    if (new RegExp(String.raw`\(?\s*await\s+${apiTextEndpoint}[\s\S]*?\)?\.data\.body\b`).test(returned)) return true;
    if ([...responseAliases].some((name) => new RegExp(`\\b${name}\\.data\\.body\\b`).test(returned))) return true;
    return [...dataAliases].some((name) => new RegExp(`\\b${name}\\.body\\b`).test(returned));
  });
};

const taintedApiStepIds = (workflow: string) => {
  const ids = new Set<string>();
  for (const block of collectStepBlocks(workflow)) {
    if (!/uses:\s*actions\/github-script@/.test(block) || !returnsGithubApiText(block)) continue;
    const id = block.match(/^\s*(?:-\s+)?["']?id["']?\s*:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/m)?.[1];
    if (id) ids.add(id);
  }
  return ids;
};

const collectRunValues = (workflow: string) => {
  const lines = workflow.split('\n');
  const values: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const parentIndent = match[1].length;
    const scalar = match[2].trim();
    if (!/^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/.test(scalar)) {
      values.push(match[2]);
      continue;
    }
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      const trimmed = line.trim();
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && indent <= parentIndent) break;
      if (trimmed) body.push(trimmed);
      index = child;
    }
    values.push(body.join('\n'));
  }
  return values;
};

const assertNoGithubApiTextOutputShell = (workflow: string, source: string) => {
  const taintedIds = taintedApiStepIds(workflow);
  for (const run of collectRunValues(workflow)) {
    for (const id of taintedIds) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const output = new RegExp(`steps\\.${escaped}\\.outputs(?:\\.[A-Za-z_][A-Za-z0-9_-]*|\\[['\"][^'\"]+['\"]\\])`, 'i');
      expect(output.test(run), `${source}: GitHub API text from ${id} reaches run`).toBe(false);
    }
  }
};

describe('GitHub API text output shell policy', () => {
  it('rejects an issue-comment body fetched through github.rest and returned to a shell sink', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - id: capture',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { data } = await github.rest.issues.getComment({ comment_id: context.payload.comment.id });',
      '            return data.body;',
      '      - run: bash -c "${{ steps.capture.outputs.result }}"',
    ].join('\n');
    expect(() => assertNoGithubApiTextOutputShell(unsafe, 'api-comment-body.yml')).toThrow();
  });

  it('allows a GitHub API call when the step returns a constant value', () => {
    const safe = [
      'on: issue_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - id: capture',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const { data } = await github.rest.issues.getComment({ comment_id: context.payload.comment.id });',
      '            core.info(data.body);',
      "            return 'echo safe';",
      '      - run: bash -c "${{ steps.capture.outputs.result }}"',
    ].join('\n');
    expect(() => assertNoGithubApiTextOutputShell(safe, 'api-comment-constant.yml')).not.toThrow();
  });

  it('scans every checked-in workflow for GitHub API text outputs reaching run', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      assertNoGithubApiTextOutputShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
