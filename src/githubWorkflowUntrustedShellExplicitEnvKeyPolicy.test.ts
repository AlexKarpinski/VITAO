import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) =>
  value.replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedEventText = (value: string) => {
  const normalized = normalizeAccess(value);
  return [
    'github.event.issue.title',
    'github.event.issue.body',
    'github.event.comment.body',
    'github.event.pull_request.title',
    'github.event.pull_request.body',
    'github.event.review.body',
    'github.event.review_comment.body',
  ].some((path) => normalized.includes(path));
};

const decodeYamlKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value.replace(/\\x([0-9A-Fa-f]{2})/g, '\\u00$1'));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const collectExplicitEnvTaint = (workflow: string) => {
  const tainted = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;
  let pendingKey: { name: string; indent: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^(?:env|["']env["'])\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      pendingKey = null;
      continue;
    }
    if (envIndent !== null && indent <= envIndent) {
      envIndent = null;
      pendingKey = null;
    }
    if (envIndent === null) continue;

    const explicitKey = trimmed.match(/^\?\s*((?:"(?:\\.|[^"])*")|(?:'(?:''|[^'])*')|(?:[A-Za-z_][A-Za-z0-9_]*))\s*$/);
    if (explicitKey) {
      const name = decodeYamlKey(explicitKey[1]);
      pendingKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? { name, indent } : null;
      continue;
    }

    if (pendingKey) {
      const explicitValue = trimmed.match(/^:\s*(.*)$/);
      if (explicitValue) {
        if (containsUntrustedEventText(explicitValue[1])) tainted.add(pendingKey.name);
        pendingKey = null;
        continue;
      }
      if (indent <= pendingKey.indent) pendingKey = null;
    }
  }
  return tainted;
};

const runReferencesEnv = (run: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?:[^}]*)?\\}|\\$env:${escaped}\\b|%${escaped}%)`, 'i').test(run);
};

const assertNoExplicitEnvShellFlow = (workflow: string, source: string) => {
  const tainted = collectExplicitEnvTaint(workflow);
  for (const line of workflow.split('\n')) {
    const run = line.match(/^\s*(?:-\s*)?(?:run|["']run["'])\s*:\s*(.*)$/)?.[1];
    if (!run) continue;
    for (const name of tainted) {
      expect(runReferencesEnv(run, name), `${source}: explicit env key ${name} reaches run`).toBe(false);
    }
  }
};

describe('GitHub workflow explicit environment-key shell policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      assertNoExplicitEnvShellFlow(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
    }
  });

  it('rejects tainted explicit environment keys used by run', () => {
    const unsafe = [
      'env:',
      '  ? CMD',
      '  : ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => assertNoExplicitEnvShellFlow(unsafe, 'explicit-env.yml')).toThrow();
  });

  it('decodes quoted explicit environment keys', () => {
    const unsafe = [
      'env:',
      '  ? "C\\u004dD"',
      '  : ${{ github.event.issue.body }}',
      'steps:',
      '  - run: sh -c "$CMD"',
    ].join('\n');
    expect(() => assertNoExplicitEnvShellFlow(unsafe, 'quoted-explicit-env.yml')).toThrow();
  });

  it('allows explicit environment keys with repository-owned values', () => {
    const safe = ['env:', '  ? CMD', '  : echo safe', 'steps:', '  - run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoExplicitEnvShellFlow(safe, 'safe.yml')).not.toThrow();
  });
});
