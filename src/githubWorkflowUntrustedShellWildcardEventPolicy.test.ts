import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

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

const wildcardEventBody = /github\.event(?:\?\.)?\.\*\.(?:title|body)\b|github\[['"]event['"]\]\[['"]\*['"]\]\[['"](?:title|body)['"]\]/;

const expectNoWildcardEventShell = (workflow: string, source: string) => {
  for (const script of collectRunScripts(workflow)) {
    expect(wildcardEventBody.test(script), `${source}: wildcard-filtered event text reaches shell`).toBe(false);
  }
};

describe('GitHub workflow wildcard event shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWildcardEventShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects wildcard-filtered issue/comment bodies in shell scripts', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  demo:',
      '    steps:',
      `      - run: "bash -c '\${{ join(github.event.*.body, ' ') }}'"`,
    ].join('\n');
    expect(() => expectNoWildcardEventShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows constant shell scripts', () => {
    const safe = ['jobs:', '  demo:', '    steps:', '      - run: echo safe'].join('\n');
    expectNoWildcardEventShell(safe, 'safe.yml');
  });
});
