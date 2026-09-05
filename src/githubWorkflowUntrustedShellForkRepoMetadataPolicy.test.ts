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
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const forkRepoText = /(?:github\.event\.pull_request\.head\.repo|context\.payload\.pull_request\.head\.repo)\.(?:description|name|full_name|default_branch|homepage)\b/;

const isEscapedQuote = (source: string, index: number) => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const collectFlowRunScripts = (line: string) => {
  const scripts: string[] = [];
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || !isEscapedQuote(line, index))) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char !== '{' && char !== ',') continue;

    const tail = line.slice(index + 1);
    const key = tail.match(/^\s*(?:run|"run"|'run')\s*:\s*/);
    if (!key) continue;

    const start = index + 1 + key[0].length;
    let valueQuote: '"' | "'" | null = null;
    let square = 0;
    let curly = 0;
    let end = line.length;
    for (let cursor = start; cursor < line.length; cursor += 1) {
      const valueChar = line[cursor];
      if (valueQuote) {
        if (valueChar === valueQuote && (valueQuote === "'" || !isEscapedQuote(line, cursor))) valueQuote = null;
        continue;
      }
      if (valueChar === '"' || valueChar === "'") {
        valueQuote = valueChar;
        continue;
      }
      if (valueChar === '[') square += 1;
      else if (valueChar === ']') {
        if (square === 0 && curly === 0) { end = cursor; break; }
        square -= 1;
      } else if (valueChar === '{') curly += 1;
      else if (valueChar === '}') {
        if (curly === 0 && square === 0) { end = cursor; break; }
        curly -= 1;
      } else if (valueChar === ',' && square === 0 && curly === 0) {
        end = cursor;
        break;
      }
    }
    scripts.push(line.slice(start, end).trim());
    index = Math.max(index, end - 1);
  }
  return scripts;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    scripts.push(...collectFlowRunScripts(raw));
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

const collectTaintedEnv = (workflow: string) => {
  const names = new Set<string>();
  for (const raw of workflow.split('\n')) {
    const match = raw.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    if (forkRepoText.test(normalizeAccess(match[2]))) names.add(match[1]);
  }
  return names;
};

const scriptReadsEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?::?[-+?=][^}]*)?\\}|\\$env:${escaped}\\b|\\$\\{env:${escaped}\\}|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const expectNoForkRepoMetadataInShell = (workflow: string, source: string) => {
  const taintedEnv = collectTaintedEnv(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(
      forkRepoText.test(normalizeAccess(script)),
      `${source}: attacker-controlled fork repository metadata reaches shell execution`,
    ).toBe(false);
    for (const name of taintedEnv) {
      expect(
        scriptReadsEnv(script, name),
        `${source}: fork repository metadata reaches shell through environment variable ${name}`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow fork-repository metadata shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoForkRepoMetadataInShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a fork repository description interpolated into a privileged shell', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: bash -c "\${{ github.event.pull_request.head.repo.description }}"`,
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-description.yml')).toThrow();
  });

  it('rejects fork metadata in flow-style run mappings', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      `    steps: [{ run: "bash -c '\${{ github.event.pull_request.head.repo.description }}'" }]`,
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-flow-description.yml')).toThrow();
  });

  it('rejects fork default-branch names interpolated into a privileged shell', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: bash -c "\${{ github.event.pull_request.head.repo.default_branch }}"`,
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-default-branch.yml')).toThrow();
  });

  it('rejects fork repository homepages interpolated into a privileged shell', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      `      - run: echo "\${{ github.event.pull_request.head.repo.homepage }}"`,
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-homepage.yml')).toThrow();
  });

  it('rejects bracket and context.payload access to fork repository metadata', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    steps:',
      `      - run: bash -c "\${{ github['event'].pull_request.head.repo['description'] }}"`,
      `      - run: bash -c "\${{ context.payload.pull_request.head.repo.full_name }}"`,
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-bracket.yml')).toThrow();
  });

  it('rejects fork repository metadata routed through an environment variable', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  demo:',
      '    env:',
      `      CMD: "\${{ github.event.pull_request.head.repo.homepage }}"`,
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoForkRepoMetadataInShell(unsafe, 'fork-homepage-env.yml')).toThrow();
  });

  it('allows constant commands that do not interpolate fork metadata', () => {
    const safe = ['on: pull_request_target', 'jobs:', '  demo:', '    steps:', '      - run: echo safe'].join('\n');
    expectNoForkRepoMetadataInShell(safe, 'safe.yml');
  });
});
