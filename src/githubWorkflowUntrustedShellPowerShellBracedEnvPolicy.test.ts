import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeGitHubExpressionAccess = (value: string) =>
  value.replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedSource = (value: string) => {
  const normalized = normalizeGitHubExpressionAccess(value);
  return [
    'github.event.issue.title',
    'github.event.issue.body',
    'github.event.comment.body',
    'github.event.pull_request.title',
    'github.event.pull_request.body',
    'github.event.review.body',
    'github.event.review_comment.body',
    'github.event.discussion.title',
    'github.event.discussion.body',
  ].some((source) => normalized.includes(source));
};

const extractTaintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (match && containsUntrustedSource(match[2])) names.add(match[1]);
  }
  return names;
};

const extractRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value && !/^[|>][+-]?[1-9]?$/.test(value)) {
      scripts.push(value);
      continue;
    }
    const indent = lines[index].match(/^\s*/)?.[0].length ?? 0;
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childIndent = lines[child].match(/^\s*/)?.[0].length ?? 0;
      if (lines[child].trim() && childIndent <= indent) break;
      if (lines[child].trim()) body.push(lines[child].trim());
      index = child;
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
};

const expectNoBracedPowerShellTaint = (workflow: string, source: string) => {
  const tainted = extractTaintedEnvNames(workflow);
  for (const script of extractRunScripts(workflow)) {
    for (const name of tainted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        new RegExp(`\\$\\{env:${escaped}\\}`, 'i').test(script),
        `${source}: shell executes untrusted text through braced PowerShell env ${name}`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow braced PowerShell env policy', () => {
  it('protects checked-in workflows from braced PowerShell env expansion', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectNoBracedPowerShellTaint(workflow, workflowFile);
    }
  });

  it('rejects braced PowerShell expansion of untrusted env values', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - shell: pwsh',
      '    run: Invoke-Expression ${env:CMD}',
    ].join('\n');

    expect(() => expectNoBracedPowerShellTaint(unsafe, 'pwsh-braced.yml')).toThrow();
  });

  it('allows braced PowerShell expansion of constant env values', () => {
    const safe = [
      'env:',
      '  CMD: Write-Output safe',
      'steps:',
      '  - shell: pwsh',
      '    run: Invoke-Expression ${env:CMD}',
    ].join('\n');

    expectNoBracedPowerShellTaint(safe, 'pwsh-braced-safe.yml');
  });
});
