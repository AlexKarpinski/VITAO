import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const pushRefSource = /(?:github\.ref_name|github\.ref|github\.event\.ref|github\[['"]ref_name['"]\]|github\[['"]ref['"]\]|github\[['"]event['"]\]\[['"]ref['"]\])/;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const envReference = (name: string) =>
  new RegExp(`(?:\\$${name}(?![A-Za-z0-9_])|\\$\\{${name}(?:[^}]*)?\\}|%${name}%|\\$env:${name}(?![A-Za-z0-9_])|\\$\\{env:${name}\\}|\\$\\{\\{\\s*env\\.${name}\\s*\\}\\})`);

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const match = raw.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (!scalarHeader.test(value)) {
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

const collectPushRefEnvNames = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');
  let envIndent: number | null = null;
  for (const raw of lines) {
    const indent = indentOf(raw);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (envIndent !== null && indent <= envIndent) envIndent = null;
    if (/^(?:-\s*)?["']?env["']?\s*:\s*$/.test(trimmed)) {
      envIndent = indent;
      continue;
    }
    if (envIndent === null || indent <= envIndent) continue;
    const binding = raw.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(.+)$/);
    if (binding && pushRefSource.test(binding[2])) names.add(binding[1]);
  }
  return names;
};

const expectNoPushRefShellExecution = (workflow: string, source: string) => {
  if (!/^\s*push\s*:/m.test(workflow)) return;
  const taintedEnv = collectPushRefEnvNames(workflow);
  for (const script of collectRunScripts(workflow)) {
    expect(pushRefSource.test(script), `${source}: attacker-controlled push ref reaches a shell run step`).toBe(false);
    for (const name of taintedEnv) {
      expect(envReference(name).test(script), `${source}: attacker-controlled push ref reaches shell through env.${name}`).toBe(false);
    }
  }
};

describe('GitHub push ref shell policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoPushRefShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct github.ref_name shell execution on push', () => {
    const unsafe = ['on:', '  push:', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', `      - run: "bash -c '${'${{ github.ref_name }}'}'"`].join('\n');
    expect(() => expectNoPushRefShellExecution(unsafe, 'push-ref-name.yml')).toThrow();
  });

  it('rejects bracket-access push refs propagated through env', () => {
    const unsafe = ['on:', '  push:', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      CMD: ${'${{ github[\'ref_name\'] }}'}`, '    steps:', '      - run: bash -c "$CMD"'].join('\n');
    expect(() => expectNoPushRefShellExecution(unsafe, 'push-ref-env.yml')).toThrow();
  });

  it('rejects github.event.ref propagated through step env', () => {
    const unsafe = ['on:', '  push:', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    steps:', '      - env:', `          CMD: ${'${{ github.event.ref }}'}`, '        run: sh -c "$CMD"'].join('\n');
    expect(() => expectNoPushRefShellExecution(unsafe, 'push-event-ref-env.yml')).toThrow();
  });

  it('allows trusted push metadata in constant shell commands', () => {
    const safe = ['on:', '  push:', 'jobs:', '  demo:', '    runs-on: ubuntu-latest', '    env:', `      REPOSITORY: ${'${{ github.repository }}'}`, '    steps:', '      - run: echo safe'].join('\n');
    expectNoPushRefShellExecution(safe, 'safe.yml');
  });
});
