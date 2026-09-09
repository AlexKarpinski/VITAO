import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedSources = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
  'github.event.discussion.body',
];

const taintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (!match) continue;
    if (untrustedSources.some((source) => match[2].includes(source))) names.add(match[1]);
  }
  return names;
};

const expectNoCmdExpansionOfTaintedEnv = (workflow: string, source: string) => {
  const tainted = taintedEnvNames(workflow);
  for (const name of tainted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const percentReference = new RegExp(`%${escaped}%`, 'i');
    const delayedReference = new RegExp(
      `cmd(?:\\.exe)?[^\\n]*\\/V(?::ON)?[^\\n]*!${escaped}!`,
      'i',
    );
    expect(percentReference.test(workflow), `${source}: cmd expands tainted env ${name}`).toBe(false);
    expect(
      delayedReference.test(workflow),
      `${source}: cmd delayed-expands tainted env ${name}`,
    ).toBe(false);
  }
};

describe('GitHub workflow cmd environment trust policy', () => {
  it('rejects cmd expansion of attacker-controlled environment variables', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - shell: cmd',
      '    run: call %CMD%',
    ].join('\n');

    expect(() => expectNoCmdExpansionOfTaintedEnv(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects delayed cmd expansion when /V:ON is enabled', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - shell: cmd',
      '    run: cmd /V:ON /C "call !CMD!"',
    ].join('\n');

    expect(() => expectNoCmdExpansionOfTaintedEnv(unsafe, 'delayed.yml')).toThrow();
  });

  it('does not treat delayed syntax as expansion without /V', () => {
    const safe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - shell: cmd',
      '    run: echo !CMD!',
    ].join('\n');

    expectNoCmdExpansionOfTaintedEnv(safe, 'delayed-disabled.yml');
  });

  it('allows cmd expansion of constant environment values', () => {
    const safe = [
      'env:',
      '  CMD: echo safe',
      'steps:',
      '  - shell: cmd',
      '    run: call %CMD%',
    ].join('\n');

    expectNoCmdExpansionOfTaintedEnv(safe, 'safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectNoCmdExpansionOfTaintedEnv(workflow, workflowFile);
    }
  });
});
