import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) =>
  value
    .replace(/\?\./g, '.')
    .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedPayload = (value: string) => {
  const normalized = normalizeAccess(value);
  return [
    'github.event.issue.title',
    'github.event.issue.body',
    'github.event.comment.body',
    'github.event.pull_request.title',
    'github.event.pull_request.body',
    'github.event.review.body',
    'github.event.review_comment.body',
    'context.payload.issue.title',
    'context.payload.issue.body',
    'context.payload.comment.body',
    'context.payload.pull_request.title',
    'context.payload.pull_request.body',
    'context.payload.review.body',
    'context.payload.review_comment.body',
  ].some((expression) => normalized.includes(expression));
};

const collectStepBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+/);
    if (!start) continue;
    const indent = start[1].length;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childTrimmed = childLine.trim();
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childTrimmed && childIndent === indent && /^\s*-\s+/.test(childLine)) break;
      if (childTrimmed && childIndent < indent) break;
      block.push(childLine);
      index = child;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

const extractTaintedStepIds = (workflow: string) => {
  const ids = new Set<string>();
  for (const block of collectStepBlocks(workflow)) {
    const id = block.match(/^\s*(?:-\s+)?id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/m)?.[1];
    if (id && containsUntrustedPayload(block)) ids.add(id);
  }
  return ids;
};

const stepOutputPattern = (stepId: string) => {
  const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`steps\\.${escaped}\\.outputs(?:\\.[A-Za-z_][A-Za-z0-9_-]*|\\[['"][^'"]+['"]\\])`, 'i');
};

const extractTaintedEnvVars = (workflow: string, taintedStepIds: Set<string>) => {
  const vars = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const value = normalizeAccess(match[2]);
    if (containsUntrustedPayload(value)) vars.add(match[1]);
    if ([...taintedStepIds].some((id) => stepOutputPattern(id).test(value))) vars.add(match[1]);
  }
  return vars;
};

const extractRunValues = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/)?.[1])
    .filter((value): value is string => Boolean(value));

const assertNoTransitiveUntrustedShell = (workflow: string, source: string) => {
  const taintedStepIds = extractTaintedStepIds(workflow);
  const taintedEnvVars = extractTaintedEnvVars(workflow, taintedStepIds);

  for (const run of extractRunValues(workflow)) {
    expect(containsUntrustedPayload(run), `${source}: direct untrusted payload in run`).toBe(false);
    for (const id of taintedStepIds) {
      expect(stepOutputPattern(id).test(normalizeAccess(run)), `${source}: tainted output from ${id} reaches run`).toBe(false);
    }
    for (const name of taintedEnvVars) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const usesEnv = new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|env\\.${escaped}\\b)`, 'i').test(normalizeAccess(run));
      expect(usesEnv, `${source}: tainted env ${name} reaches run`).toBe(false);
    }
  }
};

describe('GitHub workflow transitive untrusted shell policy', () => {
  it('recognizes optional-chained context payload text', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    id: capture',
      '    with:',
      '      script: return context.payload.comment?.body',
      '  - run: bash -c "${{ steps.capture.outputs.result }}"',
    ].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'optional-chain.yml')).toThrow();
  });

  it('tracks a tainted step id regardless of mapping-key order', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: return context.payload.comment.body',
      '    id: capture',
      '  - run: bash -c "${{ steps.capture.outputs.result }}"',
    ].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'id-order.yml')).toThrow();
  });

  it('propagates tainted step outputs through env before shell execution', () => {
    const unsafe = [
      'steps:',
      '  - id: capture',
      '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: return context.payload.comment.body',
      '  - env:',
      '      CMD: ${{ steps.capture.outputs.result }}',
      '    run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'output-env.yml')).toThrow();
  });

  it('checks every repository workflow for these transitive paths', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertNoTransitiveUntrustedShell(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
