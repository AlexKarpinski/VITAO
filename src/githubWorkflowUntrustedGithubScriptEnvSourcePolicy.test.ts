import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1')
  .replace(/\s*\.\s*/g, '.');

const untrustedEventPath = /\bgithub\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))\b/;

const containsUntrustedExpression = (value: string) => {
  for (const match of normalizeAccess(value).matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (untrustedEventPath.test(normalizeAccess(match[1]))) return true;
  }
  return false;
};

const decodeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const collectTaintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const envMatch = lines[index].match(/^(\s*)env\s*:\s*$/);
    if (!envMatch) continue;
    const envIndent = envMatch[1].length;

    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (line.trim() && indentOf(line) <= envIndent) break;
      const entry = line.match(/^\s*("[^"]+"|'[^']+'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/);
      if (!entry) continue;
      if (containsUntrustedExpression(entry[2])) names.add(decodeKey(entry[1]));
    }
  }

  for (const line of lines) {
    const flow = line.match(/\benv\s*:\s*\{([^}]*(?:\}\}[^}]*)*)\}/);
    if (!flow) continue;
    for (const entry of flow[1].matchAll(/(?:^|,)\s*("[^"]+"|'[^']+'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)(?=\s*,|$)/g)) {
      if (containsUntrustedExpression(entry[2])) names.add(decodeKey(entry[1]));
    }
  }

  return names;
};

const scriptUsesTaintedEnv = (workflow: string, taintedEnv: Set<string>) => {
  if (taintedEnv.size === 0) return false;
  const githubScript = /(?:uses|"uses"|'uses')\s*:\s*['"]?actions\/github-script@/i;
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    if (!githubScript.test(lines[index])) continue;
    const stepIndent = indentOf(lines[index]);

    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (line.trim() && indentOf(line) <= stepIndent && /^\s*-\s+/.test(line)) break;
      const script = line.match(/^\s*(?:script|"script"|'script')\s*:\s*(.+?)\s*$/);
      if (!script) continue;
      for (const name of taintedEnv) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\$\\{\\{\\s*env(?:\\.${escaped}|\\[\\s*['"]${escaped}['"]\\s*\\])\\s*\\}\\}`, 'i').test(script[1])) return true;
      }
    }
  }

  return false;
};

const expectNoEnvTaintedGithubScriptSource = (workflow: string, source: string) => {
  const taintedEnv = collectTaintedEnvNames(workflow);
  expect(scriptUsesTaintedEnv(workflow, taintedEnv), `${source}: attacker-controlled env value becomes GitHub Script source`).toBe(false);
};

describe('GitHub Script environment-source trust policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoEnvTaintedGithubScriptSource(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled env used as GitHub Script source', () => {
    const unsafe = [
      'env:',
      '  SCRIPT_BODY: ${{ github.event.comment.body }}',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: ${{ env.SCRIPT_BODY }}',
    ].join('\n');
    expect(() => expectNoEnvTaintedGithubScriptSource(unsafe, 'env-source.yml')).toThrow();
  });

  it('allows a repository-owned script selected through env', () => {
    const safe = [
      'env:',
      '  SCRIPT_BODY: core.info("safe")',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: ${{ env.SCRIPT_BODY }}',
    ].join('\n');
    expectNoEnvTaintedGithubScriptSource(safe, 'safe-env-source.yml');
  });
});
