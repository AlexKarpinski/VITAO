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

const untrustedEventText = /(?:github\.event\.(?:issue|comment|pull_request|discussion)\.(?:title|body)|context\.payload\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|discussion\.(?:title|body)))\b/;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

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

const collectTaintedStepIds = (workflow: string) => {
  const ids = new Set<string>();
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+/);
    if (!start) continue;
    const indent = start[1].length;
    const block = [lines[index]];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (line.trim() && indentOf(line) <= indent) break;
      block.push(line);
    }
    const text = normalizeAccess(block.join('\n'));
    const id = text.match(/^\s*id:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/m)?.[1];
    if (id && /actions\/github-script@/.test(text) && untrustedEventText.test(text)) ids.add(id);
    index = cursor - 1;
  }
  return ids;
};

const collectTaintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  const taintedSteps = collectTaintedStepIds(workflow);
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const value = normalizeAccess(match[2]);
    if (untrustedEventText.test(value)) names.add(match[1]);
    for (const stepId of taintedSteps) {
      const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`steps\\.${escaped}\\.outputs\\.[A-Za-z_][A-Za-z0-9_-]*`).test(value)) names.add(match[1]);
    }
  }
  return names;
};

const bashParameterReferences = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\$\\{${escaped}[^}]*\\}`, 'g').test(script)) return true;
  if (new RegExp(`\\$\\(\\([^)]*\\b${escaped}\\b[^)]*\\)\\)`, 'g').test(script)) return true;

  for (const match of script.matchAll(/(?:^|[;\n]\s*)declare\s+-n\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    if (match[2] !== name) continue;
    const alias = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\$(?:${alias}\\b|\\{${alias}[^}]*\\})`).test(script.slice(match.index + match[0].length))) return true;
  }
  return false;
};

const expectNoTaintedBashParameterExpansion = (workflow: string, source: string) => {
  const taintedEnv = collectTaintedEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    for (const name of taintedEnv) {
      expect(bashParameterReferences(script, name), `${source}: tainted environment ${name} reaches Bash parameter or arithmetic expansion`).toBe(false);
    }
  }
};

describe('GitHub workflow Bash parameter-expansion shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoTaintedBashParameterExpansion(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });
  it('rejects substring expansion of an attacker-controlled variable', () => {
    const unsafe = ['on: issue_comment','jobs:','  demo:','    env:',`      CMD: "\${{ github.event.comment.body }}"`,'    steps:','      - run: bash -c "${CMD:0}"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'substring.yml')).toThrow();
  });
  it('rejects default and replacement parameter operators too', () => {
    const unsafe = ['on: issues','jobs:','  demo:','    env:',`      CMD: "\${{ github.event.issue.body }}"`,'    steps:','      - run: bash -c "${CMD:-echo safe}"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'operator.yml')).toThrow();
  });
  it('rejects pattern substitution of an attacker-controlled variable', () => {
    const unsafe = ['on: issue_comment','jobs:','  demo:','    env:',`      CMD: "\${{ github.event.comment.body }}"`,'    steps:','      - run: bash -c "${CMD//x/x}"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'pattern-substitution.yml')).toThrow();
  });
  it('rejects arithmetic expansion of an attacker-controlled variable', () => {
    const unsafe = ['on: issue_comment','jobs:','  demo:','    env:',`      CMD: "\${{ github.event.comment.body }}"`,'    steps:','      - run: printf "%s" "$((CMD))"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'arithmetic.yml')).toThrow();
  });
  it('rejects step-output taint before Bash parameter substitution', () => {
    const unsafe = ['on: issue_comment','jobs:','  demo:','    steps:','      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567','        id: capture','        with:','          result-encoding: string','          script: return context.payload.comment.body',`      - env:`,`          CMD: "\${{ steps.capture.outputs.result }}"`,'        run: bash -c "${CMD//x/x}"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'step-output.yml')).toThrow();
  });
  it('rejects Bash nameref aliases of attacker-controlled variables', () => {
    const unsafe = ['on: issue_comment','jobs:','  demo:','    env:',`      CMD: "\${{ github.event.comment.body }}"`,'    steps:','      - run: |','          declare -n ref=CMD','          bash -c "$ref"'].join('\n');
    expect(() => expectNoTaintedBashParameterExpansion(unsafe, 'nameref.yml')).toThrow();
  });
  it('allows namerefs to constant environment values', () => {
    const safe = ['jobs:','  demo:','    env:','      CMD: echo-safe','    steps:','      - run: |','          declare -n ref=CMD','          printf "%s" "$ref"'].join('\n');
    expectNoTaintedBashParameterExpansion(safe, 'safe-nameref.yml');
  });
  it('allows parameter expansion of constant environment values', () => {
    const safe = ['jobs:','  demo:','    env:','      CMD: echo-safe','    steps:','      - run: printf "%s" "${CMD:0}"'].join('\n');
    expectNoTaintedBashParameterExpansion(safe, 'safe.yml');
  });
});
