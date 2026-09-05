import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1')
  .replace(/\[\d+\]/g, '.*');

const commitMetadataPath = /(?:head_commit|commits\.\*)\.(?:message|(?:author|committer)\.(?:name|email|username)|(?:added|removed|modified)(?:\.\*)?)\b/;
const directCommitMetadata = new RegExp(`github\\.event\\.(?:workflow_run\\.)?${commitMetadataPath.source}`);
const serializedCommitIdentity = /tojson\s*\(\s*[^)]*github\.event\.(?:workflow_run\.)?(?:head_commit|commits\.\*)\.(?:author|committer)\b[^)]*\)/i;
const containsUntrustedCommitMetadata = (value: string) =>
  directCommitMetadata.test(value) || serializedCommitIdentity.test(value);

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = raw.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (!blockHeader.test(value)) {
      scripts.push(value);
      continue;
    }
    const parentIndent = indentOf(raw);
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && indentOf(childLine) <= parentIndent) break;
      body.push(childLine.trim());
      index = child;
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
};

const splitFlowEntries = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === quote && (quote === "'" || body[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ',') { entries.push(body.slice(start, index)); start = index + 1; }
  }
  entries.push(body.slice(start));
  return entries;
};

const collectCommitMetadataEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const flowEnv = line.match(/^\s*env\s*:\s*\{([\s\S]*)\}\s*$/);
    if (flowEnv) {
      for (const entry of splitFlowEntries(flowEnv[1])) {
        const nested = entry.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
        if (nested && containsUntrustedCommitMetadata(normalizeAccess(nested[2]))) names.add(nested[1]);
      }
      continue;
    }
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    if (containsUntrustedCommitMetadata(normalizeAccess(match[2]))) names.add(match[1]);
  }
  return names;
};

const shellReferencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`,
    'i',
  ).test(script);
};

const expectNoCommitMetadataShell = (workflow: string, source: string) => {
  const scripts = collectRunScripts(workflow);
  const taintedEnv = collectCommitMetadataEnvNames(workflow);
  for (const script of scripts) {
    expect(
      containsUntrustedCommitMetadata(normalizeAccess(script)),
      `${source}: attacker-controlled commit metadata reaches shell`,
    ).toBe(false);
    for (const name of taintedEnv) {
      expect(
        shellReferencesEnv(script, name),
        `${source}: commit-metadata environment ${name} reaches shell`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow commit metadata shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoCommitMetadataShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects direct head commit messages in shell scripts', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ github.event.head_commit.message }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push.yml')).toThrow();
  });

  it('rejects messages from every commit in a push event', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ join(github.event.commits.*.message, ' ') }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-commits.yml')).toThrow();
  });

  it('rejects numerically indexed push commit messages', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ github.event.commits[0].message }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-indexed-commit.yml')).toThrow();
  });

  it('rejects pushed file paths from the head commit in shell scripts', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ join(github.event.head_commit.modified, ' ') }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-head-paths.yml')).toThrow();
  });

  it('rejects pushed file paths from every commit in shell scripts', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ join(github.event.commits.*.added, ' ') }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-commit-paths.yml')).toThrow();
  });

  it('rejects pushed file paths routed through environment variables', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    env:', `      CMD: "\${{ join(github.event.commits.*.removed, ' ') }}"`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-path-env.yml')).toThrow();
  });

  it('rejects pushed commit identity routed through environment variables', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    env:', `      CMD: "\${{ join(github.event.commits.*.author.name, ' ') }}"`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'push-commit-author-env.yml')).toThrow();
  });

  it('rejects workflow-run head commit messages in block shell scripts', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    steps:', '      - run: |', `          bash -c '\${{ github.event.workflow_run.head_commit.message }}'`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'workflow-run.yml')).toThrow();
  });

  it('rejects bracketed commit-message access', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ github['event']['workflow_run']['head_commit']['message'] }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'bracketed.yml')).toThrow();
  });

  it('rejects commit-message taint routed through environment variables', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    env:', `      CMD: "\${{ github.event.workflow_run.head_commit.message }}"`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'env.yml')).toThrow();
  });

  it('rejects commit-message taint routed through flow-style environment variables', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', `    env: { CMD: "\${{ github.event.workflow_run.head_commit.message }}" }`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'flow-env.yml')).toThrow();
  });

  it('rejects workflow-run commit author identity in shell scripts', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ github.event.workflow_run.head_commit.author.name }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'author.yml')).toThrow();
  });

  it('rejects commit committer identity routed through environment variables', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    env:', `      CMD: "\${{ github.event.workflow_run.head_commit.committer.email }}"`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'committer-env.yml')).toThrow();
  });

  it('rejects serialized workflow-run commit author identity', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ toJSON(github.event.workflow_run.head_commit.author) }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'serialized-author.yml')).toThrow();
  });

  it('rejects serialized commit committer identity case-insensitively', () => {
    const unsafe = ['on: push', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ toJson(github.event.head_commit.committer) }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'serialized-committer.yml')).toThrow();
  });

  it('rejects compound serialized commit identity arguments', () => {
    const unsafe = ['on: workflow_run', 'jobs:', '  demo:', '    steps:', `      - run: "bash -c '\${{ toJson(github.event.workflow_run.head_commit.author || null) }}'"`].join('\n');
    expect(() => expectNoCommitMetadataShell(unsafe, 'serialized-compound-author.yml')).toThrow();
  });

  it('does not case-fold ordinary commit metadata text', () => {
    const safe = ['jobs:', '  demo:', '    steps:', '      - run: echo GITHUB.EVENT.HEAD_COMMIT.MESSAGE'].join('\n');
    expectNoCommitMetadataShell(safe, 'uppercase-constant.yml');
  });

  it('allows constant shell scripts', () => {
    const safe = ['jobs:', '  demo:', '    steps:', '      - run: echo safe'].join('\n');
    expectNoCommitMetadataShell(safe, 'safe.yml');
  });
});
