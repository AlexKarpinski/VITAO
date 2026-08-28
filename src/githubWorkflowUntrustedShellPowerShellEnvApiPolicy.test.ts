import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const taintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    if (/github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(match[2])) {
      names.add(match[1]);
    }
  }
  return names;
};

const expectNoPowerShellEnvApiExecution = (workflow: string, source: string) => {
  const tainted = taintedEnvNames(workflow);
  for (const name of tainted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const read = new RegExp(`\\[Environment\\]::GetEnvironmentVariable\\(\\s*['\"]${escaped}['\"]\\s*\\)`, 'i');
    const sink = /Invoke-Expression|\biex\b|Start-Process|&\s*\(/i;
    expect(read.test(workflow) && sink.test(workflow), `${source}: PowerShell environment API executes tainted ${name}`).toBe(false);
  }
};

describe('PowerShell environment API shell boundary policy', () => {
  it('rejects execution of event-tainted variables read via GetEnvironmentVariable', () => {
    const unsafe = [
      'jobs:',
      '  check:',
      '    env:',
      '      CMD: ${{ github.event.comment.body }}',
      '    steps:',
      "      - shell: pwsh",
      "        run: Invoke-Expression ([Environment]::GetEnvironmentVariable('CMD'))",
    ].join('\n');
    expect(() => expectNoPowerShellEnvApiExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows the same API read for a constant environment value', () => {
    const safe = [
      'jobs:',
      '  check:',
      '    env:',
      '      CMD: echo-safe',
      '    steps:',
      "      - shell: pwsh",
      "        run: Write-Output ([Environment]::GetEnvironmentVariable('CMD'))",
    ].join('\n');
    expect(() => expectNoPowerShellEnvApiExecution(safe, 'safe.yml')).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoPowerShellEnvApiExecution(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
