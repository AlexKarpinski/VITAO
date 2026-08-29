import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const jobBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobsIndex = lines.findIndex((line) => /^\s*jobs\s*:\s*(?:#.*)?$/.test(line));
  if (jobsIndex < 0) return [workflow];
  const jobsIndent = indentOf(lines[jobsIndex]);
  const blocks: string[] = [];
  let start: number | null = null;
  let jobIndent: number | null = null;

  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const indent = indentOf(line);
    if (indent <= jobsIndent) break;
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(?:#.*)?$/);
    if (!key) continue;
    if (jobIndent === null) jobIndent = indent;
    if (indent !== jobIndent) continue;
    if (start !== null) blocks.push(lines.slice(start, index).join('\n'));
    start = index;
  }
  if (start !== null) blocks.push(lines.slice(start).join('\n'));
  return blocks.length ? blocks : [workflow];
};

const taintedEnvNames = (yaml: string) => {
  const names = new Set<string>();
  for (const line of yaml.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    if (/github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(match[2])) {
      names.add(match[1]);
    }
  }
  return names;
};

const collectRunScripts = (yaml: string) => {
  const scripts: string[] = [];
  const lines = yaml.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s*)?run\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (/^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/.test(value)) {
      const parentIndent = indentOf(lines[index]);
      const body: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() && indentOf(next) <= parentIndent) break;
        body.push(next);
        index += 1;
      }
      scripts.push(body.join('\n'));
    } else {
      scripts.push(value);
    }
  }
  return scripts;
};

const expectNoPowerShellEnvApiExecution = (workflow: string, source: string) => {
  for (const job of jobBlocks(workflow)) {
    const tainted = taintedEnvNames(job);
    const scripts = collectRunScripts(job);
    for (const name of tainted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const read = new RegExp(`\\[Environment\\]::GetEnvironmentVariable\\(\\s*['\"]${escaped}['\"]\\s*\\)`, 'i');
      const sink = /Invoke-Expression|\biex\b|Start-Process|&\s*\(/i;
      for (const script of scripts) {
        expect(read.test(script) && sink.test(script), `${source}: PowerShell environment API executes tainted ${name}`).toBe(false);
      }
    }
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
      '      - shell: pwsh',
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
      '      - shell: pwsh',
      "        run: Write-Output ([Environment]::GetEnvironmentVariable('CMD'))",
    ].join('\n');
    expect(() => expectNoPowerShellEnvApiExecution(safe, 'safe.yml')).not.toThrow();
  });

  it('does not combine a safe API read with a sink in another job', () => {
    const safe = [
      'jobs:',
      '  inspect:',
      '    env:',
      '      CMD: ${{ github.event.comment.body }}',
      '    steps:',
      '      - shell: pwsh',
      "        run: Write-Output ([Environment]::GetEnvironmentVariable('CMD'))",
      '  build:',
      '    steps:',
      '      - shell: pwsh',
      "        run: Start-Process npm -ArgumentList 'test'",
    ].join('\n');
    expect(() => expectNoPowerShellEnvApiExecution(safe, 'separate-jobs.yml')).not.toThrow();
  });

  it('does not combine a read and sink from separate scripts in one job', () => {
    const safe = [
      'jobs:',
      '  inspect:',
      '    env:',
      '      CMD: ${{ github.event.comment.body }}',
      '    steps:',
      '      - shell: pwsh',
      "        run: Write-Output ([Environment]::GetEnvironmentVariable('CMD'))",
      '      - shell: pwsh',
      "        run: Start-Process npm -ArgumentList 'test'",
    ].join('\n');
    expect(() => expectNoPowerShellEnvApiExecution(safe, 'separate-steps.yml')).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const name of workflowFiles) {
      expectNoPowerShellEnvApiExecution(readFileSync(join('.github/workflows', name), 'utf8'), name);
    }
  });
});
