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

const containsUntrustedShellText = (value: string) => {
  const normalized = normalizeAccess(value);
  return /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body)/.test(normalized)
    || /tojson\s*\(\s*github\.event(?:\.[A-Za-z_][A-Za-z0-9_-]*)?\s*\)/i.test(normalized);
};

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        backslashes += 1;
        continue;
      }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      backslashes = 0;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const collectShellTemplates = (workflow: string) => {
  const templates: string[] = [];
  for (const raw of workflow.split('\n')) {
    const line = stripYamlComment(raw);
    const match = line.match(/^\s*(?:-\s*)?(?:["']?shell["']?)\s*:\s*(.+?)\s*$/);
    if (match) templates.push(match[1].trim());
  }
  return templates;
};

const expectSafeShellTemplates = (workflow: string, source: string) => {
  for (const template of collectShellTemplates(workflow)) {
    expect(containsUntrustedShellText(template), `${source}: ${template}`).toBe(false);
  }
};

describe('GitHub workflow custom-shell trust policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectSafeShellTemplates(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled text interpolated into a custom shell template', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - shell: bash -c '${{ github.event.comment.body }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'custom-shell.yml')).toThrow();
  });

  it('rejects attacker-controlled pull-request head refs in shell templates', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - shell: bash -c '${{ github.event.pull_request.head.ref }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'pr-head-shell.yml')).toThrow();
  });

  it('allows constant shell templates', () => {
    const safe = ['jobs:', '  test:', '    steps:', '      - shell: bash --noprofile --norc -e -o pipefail {0}', '        run: echo safe'].join('\n');
    expectSafeShellTemplates(safe, 'safe-shell.yml');
  });
});
