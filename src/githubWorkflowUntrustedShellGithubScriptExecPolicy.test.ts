import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (script: string) => {
  const normalized = normalizePayloadAccess(script);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const shellExecutable = String.raw`(?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)|(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)`;
const shellExecutablePattern = new RegExp(`^(?:${shellExecutable})$`, 'i');

type Call = { name: string; receiver: string | null; args: string };
type Quote = "'" | '"' | '`' | null;

const extractCalls = (script: string, names: string[]): Call[] => {
  const calls: Call[] = [];
  const matcher = new RegExp(`(?:(\\b[A-Za-z_$][\\w$]*)\\s*\\.\\s*)?\\b(${names.join('|')})\\s*(?:\\?\\.\\s*)?\\(`, 'g');
  for (let match = matcher.exec(script); match; match = matcher.exec(script)) {
    const open = matcher.lastIndex - 1;
    let depth = 1;
    let quote: Quote = null;
    for (let index = open + 1; index < script.length; index += 1) {
      const char = script[index];
      if (quote) {
        if (char === '\\') {
          index += 1;
          continue;
        }
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') depth += 1;
      if (char !== ')') continue;
      depth -= 1;
      if (depth !== 0) continue;
      calls.push({ name: match[2], receiver: match[1] ?? null, args: script.slice(open + 1, index) });
      matcher.lastIndex = index + 1;
      break;
    }
  }
  return calls;
};

const splitTopLevelArgs = (value: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: Quote = null;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    else if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(value.slice(start).trim());
  return args;
};

const unquoteLiteral = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.includes('${')) {
    return trimmed.slice(1, -1);
  }
  return null;
};

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const [, name, expression] = declaration;
      if (tainted.has(name)) continue;
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (!containsUntrustedPayloadText(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }
  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsUntrustedPayloadText(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const hasUntrustedShellExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const calls = extractCalls(script, [
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'spawn',
    'spawnSync',
    'execa',
    'execaSync',
  ]);

  for (const call of calls) {
    const args = splitTopLevelArgs(call.args);
    const first = args[0] ?? '';
    const executable = unquoteLiteral(first);
    const explicitlyLaunchesShell = executable !== null && shellExecutablePattern.test(executable);
    const toolkitExec = call.receiver === 'exec' && call.name === 'exec';

    if (toolkitExec && explicitlyLaunchesShell) {
      const shellArgs = args[1] ?? '';
      if (/['"](?:-c|\/c|-Command)['"]/i.test(shellArgs) && containsTaintedValue(shellArgs, tainted)) return true;
      continue;
    }

    if (call.name === 'exec' || call.name === 'execSync') {
      if (containsTaintedValue(first, tainted)) return true;
      continue;
    }

    if (explicitlyLaunchesShell) {
      const shellArgs = args[1] ?? '';
      if (/['"](?:-c|\/c|-Command)['"]/i.test(shellArgs) && containsTaintedValue(shellArgs, tainted)) return true;
    }

    const usesShellOption = /\bshell\s*:\s*true\b/.test(call.args);
    if (usesShellOption) {
      const commandArgs = args.slice(0, Math.max(1, args.length - 1)).join(', ');
      if (containsTaintedValue(commandArgs, tainted)) return true;
    }
  }

  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoUntrustedGithubScriptShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasUntrustedShellExecution(script),
      `${source}: GitHub Script executes attacker-controlled event text through a shell API`,
    ).toBe(false);
  }
};

describe('GitHub Script shell execution trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedGithubScriptShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct child-process execution of comment text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.comment.body);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects optional calls to child-process execution sinks', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      '            cp.execSync?.(context.payload.comment.body);',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'optional-call.yml')).toThrow();
  });

  it('rejects spawn with shell true when its command is attacker controlled', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const command = context.payload.issue.body;',
      "            require('node:child_process').spawn(command, [], { shell: true });",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'spawn.yml')).toThrow();
  });

  it('rejects execFileSync when it explicitly launches Bash with attacker text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execFileSync('/bin/bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'exec-file.yml')).toThrow();
  });

  it('rejects spawnSync of an explicit shell even without shell true', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('bash', ['-c', context.payload.issue.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'spawn-shell.yml')).toThrow();
  });

  it('rejects spawnSync of a constant template-literal shell', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync(`bash`, ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'template-shell.yml')).toThrow();
  });

  it('rejects actions toolkit exec when it launches a shell with attacker text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const exec = require('@actions/exec');",
      "            await exec.exec('bash', ['-c', context.payload.comment.body]);",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptShellExecution(unsafe, 'toolkit-exec.yml')).toThrow();
  });

  it('allows actions toolkit exec when payload is passed to a non-shell executable', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const exec = require('@actions/exec');",
      "            await exec.exec('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'toolkit-exec-safe.yml');
  });

  it('allows execFileSync of a non-shell executable with payload as an argument', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execFileSync('/usr/bin/printf', ['%s', context.payload.comment.body]);",
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'exec-file-safe.yml');
  });

  it('allows unrelated payload reads beside a constant shell command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'unrelated-shell.yml');
  });

  it('allows payload text used only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
    ].join('\n');
    expectNoUntrustedGithubScriptShellExecution(safe, 'safe.yml');
  });
});
