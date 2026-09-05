import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrusted = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
];

const normalizeExpression = (value: string) =>
  value
    .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1')
    .replace(/\s*\.\s*/g, '.')
    .trim();

const containsUntrustedExpression = (value: string) => {
  for (const match of value.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    const expression = normalizeExpression(match[1]);
    if (untrusted.some((candidate) => expression.includes(candidate))) return true;
  }
  return false;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = match[2].trim();
    if (!/^[|>][0-9+-]*\s*(?:#.*)?$/.test(value)) {
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

const collectWhitespaceTaintedEnv = (workflow: string) => {
  const tainted = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const raw of lines) {
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const flow = trimmed.match(/^(?:-\s*)?env\s*:\s*\{([\s\S]*)\}\s*$/);
    if (flow) {
      for (const entry of flow[1].split(',')) {
        const match = entry.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*([\s\S]+?)\s*$/);
        if (match && containsUntrustedExpression(match[2])) tainted.add(match[1]);
      }
      continue;
    }

    if (/^(?:-\s*)?env\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }

    if (envIndent === null) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }

    const binding = trimmed.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*([\s\S]+?)\s*$/);
    if (binding && containsUntrustedExpression(binding[2])) tainted.add(binding[1]);
  }

  return tainted;
};

const referencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?=[}:+?=/%#-])|\\$env:${escaped}\\b|%${escaped}%|env\\s*\\.\\s*${escaped}\\b)`, 'i').test(script);
};

const reachesCommandSink = (script: string) =>
  /(?:^|[;&|\n]\s*)(?:bash|sh|zsh|dash|ksh|cmd(?:\.exe)?|powershell|pwsh)\b[^\n]*(?:\s-c\b|\s\/c\b|\s-command\b)|\beval\b|\bInvoke-Expression\b/i.test(script);

const expectNoWhitespaceObfuscatedUntrustedShell = (workflow: string, source: string) => {
  const taintedEnv = collectWhitespaceTaintedEnv(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(
      containsUntrustedExpression(script),
      `${source}: run step references untrusted GitHub text through whitespace-obfuscated dereference`,
    ).toBe(false);

    if (!reachesCommandSink(script)) continue;
    for (const name of taintedEnv) {
      expect(
        referencesEnv(script, name),
        `${source}: command sink references ${name} tainted through a whitespace-obfuscated GitHub expression`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow untrusted expression whitespace policy', () => {
  it('rejects whitespace around dot dereferences', () => {
    const unsafe = 'steps:\n  - run: echo "${{ github . event . comment . body }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects mixed bracket and whitespace dereferences', () => {
    const unsafe = 'steps:\n  - run: echo "${{ github [\'event\'] . issue [\'body\'] }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(unsafe, 'unsafe-brackets.yml')).toThrow();
  });

  it('propagates spaced expressions from flow-style env into command sinks', () => {
    const unsafe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - env: { CMD: "${{ github . event . comment . body }}" }',
      '        run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(unsafe, 'unsafe-env.yml')).toThrow();
  });

  it('allows quoted data-only reads of the same tainted environment value', () => {
    const safe = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - env: { BODY: "${{ github . event . comment . body }}" }',
      '        run: printf \'%s\\n\' "$BODY"',
    ].join('\n');
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(safe, 'safe-env-data.yml')).not.toThrow();
  });

  it('allows unrelated spaced expressions', () => {
    const safe = 'steps:\n  - run: echo "${{ github . repository }}"';
    expect(() => expectNoWhitespaceObfuscatedUntrustedShell(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces the boundary across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoWhitespaceObfuscatedUntrustedShell(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
