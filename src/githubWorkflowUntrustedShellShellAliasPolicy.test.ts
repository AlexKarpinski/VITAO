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

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
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
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const collectAliasedShellTemplates = (workflow: string) => {
  const anchors = new Map<string, string>();
  const templates: string[] = [];

  for (const rawLine of workflow.split('\n')) {
    const line = stripYamlComment(rawLine);
    if (!line.trim()) continue;

    const anchor = line.match(/:\s*&([A-Za-z0-9_-]+)\s+(.+?)\s*$/);
    if (anchor) anchors.set(anchor[1], anchor[2].trim());

    const shellAlias = line.match(/^\s*(?:-\s*)?["']?shell["']?\s*:\s*\*([A-Za-z0-9_-]+)\s*$/);
    if (!shellAlias) continue;
    const resolved = anchors.get(shellAlias[1]);
    if (resolved) templates.push(resolved);
  }

  return templates;
};

const expectSafeAliasedShellTemplates = (workflow: string, source: string) => {
  for (const template of collectAliasedShellTemplates(workflow)) {
    expect(containsUntrustedShellText(template), `${source}: ${template}`).toBe(false);
  }
};

describe('GitHub workflow aliased custom-shell trust policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectSafeAliasedShellTemplates(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled text hidden behind a shell scalar alias', () => {
    const unsafe = [
      "x-shell: &unsafe-shell bash -c '${{ github.event.comment.body }}' -- {0}",
      'jobs:',
      '  test:',
      '    steps:',
      '      - shell: *unsafe-shell',
      '        run: echo safe',
    ].join('\n');
    expect(() => expectSafeAliasedShellTemplates(unsafe, 'aliased-shell.yml')).toThrow();
  });

  it('allows repository-owned shell templates hidden behind aliases', () => {
    const safe = [
      'x-shell: &safe-shell bash --noprofile --norc -e -o pipefail {0}',
      'jobs:',
      '  test:',
      '    steps:',
      '      - shell: *safe-shell',
      '        run: echo safe',
    ].join('\n');
    expectSafeAliasedShellTemplates(safe, 'safe-aliased-shell.yml');
  });
});
