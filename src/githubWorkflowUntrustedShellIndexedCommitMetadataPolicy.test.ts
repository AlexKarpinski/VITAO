import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const blockScalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const match = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;

    const value = match[1].trim();
    const indent = lines[index].match(/^\s*/)?.[0].length ?? 0;
    if (!blockScalarHeader.test(value)) {
      scripts.push(value);
      continue;
    }

    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = stripYamlComment(raw).trim();
      const childIndent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && childIndent <= indent) break;
      if (trimmed) body.push(trimmed);
      index = child;
    }
    scripts.push(body.join('\n'));
  }

  return scripts;
};

const indexedCommitMetadata = /github\s*\.\s*event\s*\.\s*commits\s*\[\s*\d+\s*\]\s*\.\s*(?:message|(?:author|committer)\s*\.\s*(?:name|email|username)|(?:added|removed|modified)(?:\s*\[|\s*\.))/i;

const expectNoIndexedCommitMetadataInShell = (workflow: string, source: string) => {
  for (const script of collectRunScripts(workflow)) {
    expect(script, `${source}: indexed push-commit metadata must not reach a shell run step`).not.toMatch(indexedCommitMetadata);
  }
};

describe('GitHub workflow indexed commit metadata shell policy', () => {
  it('rejects numerically indexed push-commit metadata in shell run steps', () => {
    const unsafe = [
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - run: bash -c '${{ github.event.commits[0].message }}'",
    ].join('\n');

    expect(() => expectNoIndexedCommitMetadataInShell(unsafe, 'indexed-message.yml')).toThrow();
  });

  it('rejects indexed commit identity and path metadata in block run scalars', () => {
    const unsafe = [
      'on: push',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: |',
      "          bash -c '${{ github.event.commits[12].author.name }}'",
      "          bash -c '${{ github.event.commits[12].modified[0] }}'",
    ].join('\n');

    expect(() => expectNoIndexedCommitMetadataInShell(unsafe, 'indexed-metadata.yml')).toThrow();
  });

  it('allows constant shell text and scans every checked-in workflow', () => {
    expectNoIndexedCommitMetadataInShell('on: push\njobs:\n  build:\n    steps:\n      - run: echo safe', 'safe.yml');
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoIndexedCommitMetadataInShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
