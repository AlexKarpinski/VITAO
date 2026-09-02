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
  return /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body)/.test(normalized)
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

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockScalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const splitFlowMapping = (body: string) => {
  const entries: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let braces = 0;
  let brackets = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
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
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === ',' && braces === 0 && brackets === 0) {
      entries.push(body.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(body.slice(start));
  return entries;
};

const collectFlowShellTemplates = (line: string) => {
  const templates: string[] = [];
  const structural = stripYamlComment(line);
  const stepsMatch = structural.match(/(?:^|[,{}])\s*["']?steps["']?\s*:\s*\[/);
  if (!stepsMatch || stepsMatch.index === undefined) return templates;

  const sequenceStart = structural.indexOf('[', stepsMatch.index);
  if (sequenceStart < 0) return templates;
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  let sequenceDepth = 0;
  let mappingStart: number | null = null;
  let mappingDepth = 0;

  for (let index = sequenceStart; index < structural.length; index += 1) {
    const char = structural[index];
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
    if (char === '[') sequenceDepth += 1;
    else if (char === ']') {
      sequenceDepth -= 1;
      if (sequenceDepth === 0) break;
    } else if (char === '{') {
      if (sequenceDepth === 1 && mappingDepth === 0) mappingStart = index + 1;
      mappingDepth += 1;
    } else if (char === '}') {
      mappingDepth -= 1;
      if (sequenceDepth === 1 && mappingDepth === 0 && mappingStart !== null) {
        const mappingBody = structural.slice(mappingStart, index);
        for (const entry of splitFlowMapping(mappingBody)) {
          const match = entry.match(/^\s*["']?shell["']?\s*:\s*(.+?)\s*$/);
          if (match) templates.push(match[1]);
        }
        mappingStart = null;
      }
    }
  }
  return templates;
};

const collectShellTemplates = (workflow: string) => {
  const templates: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    templates.push(...collectFlowShellTemplates(line));
    const match = line.match(/^\s*(?:-\s*)?(?:["']?shell["']?)\s*:\s*(.+?)\s*$/);
    if (!match) continue;

    const value = match[1].trim();
    if (!blockScalarHeader.test(value)) {
      templates.push(value);
      continue;
    }

    const parentIndent = indentOf(raw);
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childRaw = lines[child];
      const childTrimmed = stripYamlComment(childRaw).trim();
      if (childTrimmed && indentOf(childRaw) <= parentIndent) break;
      if (childTrimmed) body.push(childTrimmed);
      index = child;
    }
    templates.push(body.join('\n'));
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

  it('rejects flow-style custom shell keys', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  test: { runs-on: ubuntu-latest, steps: [{ shell: "bash -c \'${{ github.event.comment.body }}\' -- {0}", run: echo safe }] }',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'flow-custom-shell.yml')).toThrow();
  });

  it('ignores shell-like keys nested below a flow step', () => {
    const safe = [
      'jobs:',
      '  test: { runs-on: ubuntu-latest, steps: [{ run: echo safe, env: { shell: "${{ github.event.comment.body }}" } }] }',
    ].join('\n');
    expectSafeShellTemplates(safe, 'nested-shell-data.yml');
  });

  it('rejects review-comment diff hunks interpolated into a custom shell template', () => {
    const unsafe = [
      'on: pull_request_review_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - shell: bash -c '${{ github.event.comment.diff_hunk }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'review-diff-shell.yml')).toThrow();
  });

  it('rejects review-comment paths interpolated into a custom shell template', () => {
    const unsafe = [
      'on: pull_request_review_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      "      - shell: bash -c '${{ github.event.comment.path }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'review-path-shell.yml')).toThrow();
  });

  it('rejects attacker-controlled text inside block-scalar custom shell templates', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - shell: >-',
      "          bash -c '${{ github.event.comment.body }}' -- {0}",
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeShellTemplates(unsafe, 'block-shell.yml')).toThrow();
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
