import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) =>
  value.replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const preEditSources = [
  'github.event.changes.body.from',
  'github.event.changes.title.from',
  'context.payload.changes.body.from',
  'context.payload.changes.title.from',
];

const containsPreEditText = (value: string) => {
  const normalized = normalizeAccess(value);
  return preEditSources.some((source) => normalized.includes(source));
};

const collectRunScripts = (workflow: string) => {
  const lines = workflow.split('\n');
  const scripts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const value = match[2].trim();
    if (!/^[|>][+-]?[1-9]?$|^[|>][1-9][+-]?$/.test(value)) {
      scripts.push(value);
      continue;
    }

    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childLine.trim() && childIndent <= indent) break;
      if (childLine.trim()) body.push(childLine.trim());
      index = child;
    }
    scripts.push(body.join('\n'));
  }

  return scripts;
};

const collectPreEditEnvVars = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (/^\s*env\s*:\s*$/.test(line)) {
      envIndent = indent;
      continue;
    }
    if (envIndent === null) continue;
    if (indent <= envIndent) {
      envIndent = null;
      continue;
    }
    const entry = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (entry && containsPreEditText(entry[2])) names.add(entry[1]);
  }

  return names;
};

const scriptExecutesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reference = `(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`;
  const sink = '(?:bash\\s+-c|sh\\s+-c|eval\\b|Invoke-Expression\\b)';
  return new RegExp(`${sink}[\\s\\S]*${reference}`, 'i').test(normalizeAccess(script));
};

const expectNoPreEditTextInShell = (workflow: string, source: string) => {
  const envVars = collectPreEditEnvVars(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(containsPreEditText(script), `${source}: run step directly references pre-edit user text`).toBe(false);
    for (const name of envVars) {
      expect(scriptExecutesEnv(script, name), `${source}: pre-edit user text reaches a shell sink through env ${name}`).toBe(false);
    }
  }
};

describe('GitHub workflow pre-edit text shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoPreEditTextInShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects previous issue and pull-request text in run steps', () => {
    const unsafe = [
      "steps:\n  - run: bash -c '${{ github.event.changes.body.from }}'",
      "steps:\n  - run: bash -c '${{ github.event.changes.title.from }}'",
      "steps:\n  - run: bash -c '${{ github['event']['changes']['body']['from'] }}'",
    ];
    for (const workflow of unsafe) {
      expect(() => expectNoPreEditTextInShell(workflow, 'pre-edit-direct.yml')).toThrow();
    }
  });

  it('rejects context.payload pre-edit text routed through env into an execution sink', () => {
    const unsafe = [
      'env:',
      '  CMD: context.payload.changes.body.from',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoPreEditTextInShell(unsafe, 'pre-edit-env.yml')).toThrow();
  });

  it('allows pre-edit text passed safely as quoted data through env', () => {
    const safe = [
      'env:',
      '  BODY: ${{ github.event.changes.body.from }}',
      'steps:',
      "  - run: printf '%s\\n' \"$BODY\"",
    ].join('\n');
    expectNoPreEditTextInShell(safe, 'pre-edit-safe-data.yml');
  });
});
