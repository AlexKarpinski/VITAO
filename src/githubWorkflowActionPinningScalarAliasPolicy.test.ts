import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const anchoredScalar = (line: string) => line.match(
  /^\s*(?:-\s*)?(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*&([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?)\s*$/,
);

const usesAlias = (line: string) => line.match(
  /^\s*(?:-\s*)?(?:"uses"|'uses'|uses)\s*:\s*\*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:#.*)?$/,
);

const unwrapYamlScalar = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; }
    catch { return value.slice(1, -1); }
  }
  return value.replace(/\s+#.*$/, '').trim();
};

const expectImmutableRemoteRef = (value: string, source: string) => {
  const resolved = unwrapYamlScalar(value);
  if (resolved.startsWith('./') || resolved.startsWith('docker://')) return;

  const remote = resolved.match(/^[^@\s/]+\/[^@\s/]+(?:\/[^@\s]+)*@([^\s]+)$/);
  if (!remote) return;
  expect(remote[1], `${source}: aliased remote action/workflow ref must use a full commit SHA`).toMatch(/^[0-9a-fA-F]{40}$/);
};

const expectPinnedUsesAliases = (workflow: string, source: string) => {
  const anchors = new Map<string, string>();

  for (const line of workflow.split('\n')) {
    const anchor = anchoredScalar(line);
    if (anchor) anchors.set(anchor[1], anchor[2]);

    const alias = usesAlias(line);
    if (!alias) continue;
    const resolved = anchors.get(alias[1]);
    if (resolved) expectImmutableRemoteRef(resolved, source);
  }
};

describe('GitHub workflow action-pinning scalar-alias policy', () => {
  it('scans every checked-in workflow for remote uses values hidden behind scalar aliases', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectPinnedUsesAliases(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a mutable action ref resolved through a scalar alias', () => {
    const unsafe = `env:\n  CHECKOUT: &checkout actions/checkout@v4\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: *checkout`;
    expect(() => expectPinnedUsesAliases(unsafe, 'mutable-alias.yml')).toThrow();
  });

  it('accepts a full commit SHA resolved through a scalar alias', () => {
    const safe = `env:\n  CHECKOUT: &checkout actions/checkout@0123456789abcdef0123456789abcdef01234567\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: *checkout`;
    expectPinnedUsesAliases(safe, 'pinned-alias.yml');
  });
});
