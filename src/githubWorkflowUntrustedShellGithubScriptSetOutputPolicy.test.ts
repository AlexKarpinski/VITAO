import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const untrustedExpressions = [
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
];

const containsUntrustedPayload = (value: string) => {
  const normalized = normalizeAccess(value);
  return untrustedExpressions.some((expression) => normalized.includes(expression));
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

const taintedSetOutputStepIds = (workflow: string) => {
  const ids = new Set<string>();
  for (const block of collectStepBlocks(workflow)) {
    if (!/uses:\s*actions\/github-script@/i.test(block)) continue;
    const id = block.match(/^\s*(?:-\s+)?["']?id["']?\s*:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/m)?.[1];
    if (!id) continue;

    const normalized = normalizeAccess(block);
    const aliases = new Set<string>();
    for (const expression of untrustedExpressions) {
      const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const match of normalized.matchAll(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*${escaped}\\b`, 'g'))) {
        aliases.add(match[1]);
      }
    }

    const setOutputCalls = normalized.matchAll(/\bcore\.setOutput\s*\(\s*[^,]+,\s*([^\n;]+?)\s*\)\s*;?/g);
    for (const match of setOutputCalls) {
      const value = match[1];
      const aliasTainted = [...aliases].some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(value));
      if (containsUntrustedPayload(value) || aliasTainted) {
        ids.add(id);
        break;
      }
    }
  }
  return ids;
};

const outputPattern = (stepId: string) => {
  const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`steps\\.${escaped}\\.outputs(?:\\.[A-Za-z_][A-Za-z0-9_-]*|\\[['"][^'"]+['"]\\])`, 'i');
};

const collectRunValues = (workflow: string) => {
  const lines = workflow.split('\n');
  const runs: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    if (/^[|>]/.test(match[2].trim())) {
      const body: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childLine = lines[child];
        const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
        if (childLine.trim() && childIndent <= indent) break;
        if (childLine.trim()) body.push(childLine.trim());
        index = child;
      }
      runs.push(body.join('\n'));
    } else if (match[2]) {
      runs.push(match[2]);
    }
  }
  return runs;
};

const assertNoTaintedSetOutputReachesShell = (workflow: string, source: string) => {
  const taintedIds = taintedSetOutputStepIds(workflow);
  for (const run of collectRunValues(workflow)) {
    for (const id of taintedIds) {
      expect(outputPattern(id).test(normalizeAccess(run)), `${source}: tainted core.setOutput value from ${id} reaches run`).toBe(false);
    }
  }
};

describe('GitHub Script core.setOutput untrusted shell policy', () => {
  it('rejects attacker-controlled setOutput values executed by a later step', () => {
    const unsafe = [
      'steps:',
      '  - id: capture',
      '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        core.setOutput('cmd', context.payload.comment.body);",
      '  - run: bash -c "${{ steps.capture.outputs.cmd }}"',
    ].join('\n');
    expect(() => assertNoTaintedSetOutputReachesShell(unsafe, 'set-output.yml')).toThrow();
  });

  it('rejects attacker-controlled setOutput values through a local alias', () => {
    const unsafe = [
      'steps:',
      '  - id: capture',
      '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      '        const command = context.payload.comment.body;',
      "        core.setOutput('cmd', command);",
      '  - run: bash -c "${{ steps.capture.outputs.cmd }}"',
    ].join('\n');
    expect(() => assertNoTaintedSetOutputReachesShell(unsafe, 'set-output-alias.yml')).toThrow();
  });

  it('allows constant setOutput values even when untrusted text is only logged', () => {
    const safe = [
      'steps:',
      '  - id: capture',
      '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      '        core.info(context.payload.comment.body);',
      "        core.setOutput('cmd', 'echo safe');",
      '  - run: bash -c "${{ steps.capture.outputs.cmd }}"',
    ].join('\n');
    expect(() => assertNoTaintedSetOutputReachesShell(safe, 'set-output-safe.yml')).not.toThrow();
  });

  it('checks every repository workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertNoTaintedSetOutputReachesShell(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });
});
