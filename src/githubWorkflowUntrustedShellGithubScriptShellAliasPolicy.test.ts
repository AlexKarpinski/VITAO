import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const shellName = (value: string) => /^(?:.*\/)?(?:bash|sh|dash|ksh|zsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test(value);
const untrusted = (value: string) => /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|discussion\.(?:title|body))/.test(value);

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/uses\s*:\s*['"]?actions\/github-script@/.test(lines[i])) continue;
    const stepIndent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    for (let j = i + 1; j < lines.length; j += 1) {
      const indent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (lines[j].trim() && indent <= stepIndent && /^\s*-/.test(lines[j])) break;
      const block = lines[j].match(/^\s*script\s*:\s*[|>][+-]?\s*$/);
      if (!block) continue;
      const scriptIndent = indent;
      const body: string[] = [];
      for (let k = j + 1; k < lines.length; k += 1) {
        const bodyIndent = lines[k].match(/^\s*/)?.[0].length ?? 0;
        if (lines[k].trim() && bodyIndent <= scriptIndent) break;
        body.push(lines[k].trim());
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const hasAliasedShellExecution = (script: string) => {
  const constants = new Map<string, string>();
  for (const match of script.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\n]+)\2\s*;/g)) {
    constants.set(match[1], match[3]);
  }
  for (const match of script.matchAll(/\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\[([\s\S]*?)\]\s*\)/g)) {
    const executable = constants.get(match[1]);
    if (!executable || !shellName(executable)) continue;
    if (!/(?:^|,)\s*['"](?:-c|\/c|-Command)['"]\s*,/i.test(match[2])) continue;
    if (untrusted(match[2])) return true;
  }
  return false;
};

const expectNoAliasedShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(hasAliasedShellExecution(script), `${source}: constant shell alias executes attacker-controlled text`).toBe(false);
  }
};

describe('GitHub Script constant shell executable aliases', () => {
  it('scans checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoAliasedShellExecution(readFileSync(join('.github/workflows', file), 'utf8'), file);
  });

  it('rejects a constant Bash alias used by spawnSync', () => {
    const unsafe = [
      'jobs:', '  demo:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const shell = '/bin/bash';",
      "            spawnSync(shell, ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoAliasedShellExecution(unsafe, 'alias.yml')).toThrow();
  });

  it('rejects an absolute Bash alias used by execFileSync', () => {
    const unsafe = [
      'jobs:', '  demo:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const shell = '/usr/bin/bash';",
      "            execFileSync(shell, ['-c', context.payload.issue.body]);",
    ].join('\n');
    expect(() => expectNoAliasedShellExecution(unsafe, 'absolute-alias.yml')).toThrow();
  });

  it('allows a constant non-shell executable alias', () => {
    const safe = [
      'jobs:', '  demo:', '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:', '          script: |',
      "            const tool = '/usr/bin/printf';",
      "            execFileSync(tool, ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoAliasedShellExecution(safe, 'safe.yml');
  });
});
