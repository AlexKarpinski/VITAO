import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedExpression = (value: string) =>
  /\$\{\{[\s\S]*github\s*\.\s*event\s*\.\s*(?:issue|comment|pull_request|review|discussion)[\s\S]*\}\}/i.test(value);

const taintedEnvNames = (workflow: string) => {
  const names = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (match && untrustedExpression(match[2])) names.add(match[1]);
  }
  return names;
};

const githubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?(?:\s+#.*)?$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const indent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (raw.trim() && indent <= stepIndent && /^\s*-\s+/.test(raw)) break;
      const script = raw.match(/^(\s*)script\s*:\s*([|>])[-+1-9]*\s*(?:#.*)?$/);
      if (!script) continue;
      const scriptIndent = script[1].length;
      const body: string[] = [];
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyIndent = bodyRaw.match(/^\s*/)?.[0].length ?? 0;
        if (bodyRaw.trim() && bodyIndent <= scriptIndent) break;
        body.push(bodyRaw.trim());
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const scriptExecutesTaintedEnv = (script: string, name: string) => {
  const envRead = new RegExp(`process\\s*\\.\\s*env(?:\\s*\\.\\s*${name}|\\s*\\[\\s*['"]${name}['"]\\s*\\])`);
  const taintedLocals = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) {
      const [, local, initializer] = match;
      const inheritsTaint = envRead.test(initializer) || Array.from(taintedLocals).some((tainted) => new RegExp(`\\b${tainted}\\b`).test(initializer));
      if (inheritsTaint && !taintedLocals.has(local)) {
        taintedLocals.add(local);
        changed = true;
      }
    }
  }

  for (const call of script.matchAll(/\b(?:exec|execSync)\s*\(([^)]*)\)/gs)) {
    const argument = call[1];
    if (envRead.test(argument)) return true;
    if (Array.from(taintedLocals).some((tainted) => new RegExp(`\\b${tainted}\\b`).test(argument))) return true;
  }

  const explicitShellSink = /(?:spawn|spawnSync|execFile|execFileSync)\s*\([^)]*(?:bash|sh|cmd|powershell|pwsh)[^)]*/gs;
  for (const call of script.matchAll(explicitShellSink)) {
    const invocation = call[0];
    if (envRead.test(invocation)) return true;
    if (Array.from(taintedLocals).some((tainted) => new RegExp(`\\b${tainted}\\b`).test(invocation))) return true;
  }
  return false;
};

const executesTaintedEnv = (workflow: string) => {
  const tainted = taintedEnvNames(workflow);
  if (tainted.size === 0) return false;
  for (const script of githubScriptBodies(workflow)) {
    for (const name of tainted) {
      if (scriptExecutesTaintedEnv(script, name)) return true;
    }
  }
  return false;
};

const expectNoWorkflowEnvToGithubScriptShell = (workflow: string, source: string) => {
  expect(executesTaintedEnv(workflow), `${source}: attacker-controlled env reaches a GitHub Script child-process shell sink`).toBe(false);
};

describe('GitHub Script workflow environment trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWorkflowEnvToGithubScriptShell(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects comment text routed through workflow env into execSync', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'jobs:',
      '  check:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(process.env.CMD)",
    ].join('\n');
    expect(() => expectNoWorkflowEnvToGithubScriptShell(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects workflow env taint propagated through a local script variable', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'jobs:',
      '  check:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const command = process.env.CMD',
      "            require('node:child_process').execSync(command)",
    ].join('\n');
    expect(() => expectNoWorkflowEnvToGithubScriptShell(unsafe, 'local-alias.yml')).toThrow();
  });

  it('accepts a constant local command despite a tainted workflow env binding', () => {
    const safe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'jobs:',
      '  check:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const command = 'echo safe'",
      "            require('node:child_process').execSync(command)",
    ].join('\n');
    expectNoWorkflowEnvToGithubScriptShell(safe, 'safe-local.yml');
  });

  it('accepts a constant environment command', () => {
    const safe = [
      'env:',
      '  CMD: echo safe',
      'jobs:',
      '  check:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(process.env.CMD)",
    ].join('\n');
    expectNoWorkflowEnvToGithubScriptShell(safe, 'safe.yml');
  });
});
