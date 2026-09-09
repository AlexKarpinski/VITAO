import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedExpression = /\$\{\{\s*github(?:\[['"]event['"]\]|\.event)(?:\[['"](?:issue|comment|pull_request|review|review_comment)['"]\]|\.(?:issue|comment|pull_request|review|review_comment))(?:\[['"](?:title|body)['"]\]|\.(?:title|body))\s*\}\}/;

const collectTaintedPlainEnvVars = (workflow: string) => {
  const lines = workflow.split('\n');
  const tainted = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^|>].*)$/);
    if (!match) continue;

    const parentIndent = match[1].length;
    const pieces = [match[3].trim()];
    let child = index + 1;
    for (; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (!trimmed || indent <= parentIndent) break;
      if (indent === parentIndent + 2 && /^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(trimmed)) break;
      pieces.push(trimmed);
    }

    if (untrustedExpression.test(pieces.join(' '))) tainted.add(match[2]);
    if (child > index + 1) index = child - 1;
  }

  return tainted;
};

const runScripts = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?run\s*:\s*(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));

const referencesEnvVar = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?::[-+?=][^}]*)?\\}|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const expectNoMultilinePlainEnvTaint = (workflow: string, source: string) => {
  const tainted = collectTaintedPlainEnvVars(workflow);
  for (const script of runScripts(workflow)) {
    for (const name of tainted) {
      expect(referencesEnvVar(script, name), `${source}: shell executes tainted multiline plain env ${name}`).toBe(false);
    }
  }
};

describe('GitHub workflow multiline plain env taint policy', () => {
  it('enforces the policy for every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      expectNoMultilinePlainEnvTaint(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects untrusted expressions folded into multiline plain env scalars', () => {
    const unsafe = [
      'env:',
      '  CMD: echo safe',
      '    ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoMultilinePlainEnvTaint(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows multiline plain env scalars that remain trusted', () => {
    const safe = [
      'env:',
      '  CMD: echo safe',
      '    and still safe',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoMultilinePlainEnvTaint(safe, 'safe.yml')).not.toThrow();
  });
});
