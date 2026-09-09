import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedExpression = (value: string) => {
  const normalized = normalizeAccess(value);
  return /\$\{\{[\s\S]*github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))[\s\S]*\}\}/.test(normalized);
};

const anchoredScalar = (line: string) => line.match(
  /^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/,
);

const runAlias = (line: string) => line.match(
  /^\s*(?:-\s*)?(?:"run"|'run'|run)\s*:\s*\*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:#.*)?$/,
);

const expectNoUntrustedRunAliases = (workflow: string, source: string) => {
  const anchors = new Map<string, string>();

  for (const line of workflow.split('\n')) {
    const anchor = anchoredScalar(line);
    if (anchor) anchors.set(anchor[1], anchor[2]);

    const alias = runAlias(line);
    if (!alias) continue;

    const resolved = anchors.get(alias[1]);
    if (!resolved) continue;
    expect(
      containsUntrustedExpression(resolved),
      `${source}: run alias *${alias[1]} resolves to untrusted GitHub event text`,
    ).toBe(false);
  }
};

describe('GitHub workflow run scalar-alias security policy', () => {
  it('scans every checked-in workflow for run aliases that resolve to untrusted text', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedRunAliases(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a run alias resolving to commenter-controlled shell text', () => {
    const unsafe = `env:\n  STORED_COMMAND: &command "bash -c '\${{ github.event.comment.body }}'"\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: *command`;
    expect(() => expectNoUntrustedRunAliases(unsafe, 'run-alias.yml')).toThrow();
  });

  it('allows a run alias resolving to repository-owned shell text', () => {
    const safe = `env:\n  STORED_COMMAND: &command "printf '%s\\n' safe"\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: *command`;
    expectNoUntrustedRunAliases(safe, 'safe-run-alias.yml');
  });
});
