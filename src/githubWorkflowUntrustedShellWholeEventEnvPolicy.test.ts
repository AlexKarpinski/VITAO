import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && (quote === "'" || value[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const wholeEventExpression = /\$\{\{\s*tojson\s*\(\s*github\s*\.\s*event\s*\)\s*\}\}/i;

const collectWholeEventEnvNames = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const raw of lines) {
    const line = stripYamlComment(raw);
    const trimmed = line.trim();
    if (!trimmed) continue;
    const indent = indentOf(raw);

    if (envIndent !== null && indent <= envIndent) envIndent = null;
    if (/^["']?env["']?\s*:\s*$/.test(trimmed)) { envIndent = indent; continue; }
    if (envIndent === null || indent <= envIndent) continue;

    const assignment = trimmed.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (assignment && wholeEventExpression.test(assignment[2])) names.add(assignment[1]);
  }

  return names;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const match = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (/^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/.test(value)) {
      const baseIndent = indentOf(raw);
      const body: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childRaw = lines[child];
        const childTrim = stripYamlComment(childRaw).trim();
        if (!childTrim) continue;
        if (indentOf(childRaw) <= baseIndent) break;
        body.push(childTrim);
        index = child;
      }
      scripts.push(body.join('\n'));
    } else {
      scripts.push(value);
    }
  }
  return scripts;
};

const scriptExecutesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reads = new RegExp(`\\$${escaped}(?![A-Za-z0-9_])|\\$\\{${escaped}(?:[:}])|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\}`).test(script);
  if (!reads) return false;
  return /\b(?:bash|sh|zsh)\s+-c\b|\beval\b|\b(?:source|\.)\s+<\(/.test(script);
};

const violations = (workflow: string) => {
  const names = collectWholeEventEnvNames(workflow);
  const scripts = collectRunScripts(workflow);
  return scripts.filter((script) => [...names].some((name) => scriptExecutesEnv(script, name)));
};

const expectNoWholeEventEnvExecution = (workflow: string, source: string) => {
  expect(violations(workflow), source).toEqual([]);
};

describe('GitHub workflow whole-event environment taint policy', () => {
  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoWholeEventEnvExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects whole-event serialization routed through env into bash -c', () => {
    const unsafe = [
      'on: issue_comment',
      'jobs:',
      '  test:',
      '    env:',
      '      EVENT_JSON: ${{ toJSON(github.event) }}',
      '    steps:',
      '      - run: bash -c "$(jq -r .comment.body <<< \'$EVENT_JSON\')"',
    ].join('\n');
    expect(() => expectNoWholeEventEnvExecution(unsafe, 'whole-event.yml')).toThrow();
  });

  it('recognizes case variants of toJson', () => {
    const unsafe = [
      'env:',
      '  EVENT_JSON: ${{ toJson(github.event) }}',
      'steps:',
      '  - run: bash -c "$EVENT_JSON"',
    ].join('\n');
    expect(() => expectNoWholeEventEnvExecution(unsafe, 'case-variant.yml')).toThrow();
  });

  it('allows whole-event data passed only to a quoted data sink', () => {
    const safe = [
      'env:',
      '  EVENT_JSON: ${{ toJSON(github.event) }}',
      'steps:',
      '  - run: printf "%s\\n" "$EVENT_JSON"',
    ].join('\n');
    expectNoWholeEventEnvExecution(safe, 'data-only.yml');
  });
});
