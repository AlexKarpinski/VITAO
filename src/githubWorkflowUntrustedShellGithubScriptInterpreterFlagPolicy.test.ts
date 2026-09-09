import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scriptHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?(?:\s+#.*)?$/;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const githubScriptBodies = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = stripYamlComment(lines[index]).match(/^\s*-?\s*uses\s*:\s*['"]?actions\/github-script@/);
    if (!uses) continue;
    const stepIndent = indentOf(lines[index]);
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = stripYamlComment(raw).trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = stripYamlComment(raw).match(/^\s*script\s*:\s*(.*?)\s*$/);
      if (!script) continue;
      const value = script[1].trim();
      if (scriptHeader.test(value)) {
        const body: string[] = [];
        const parentIndent = indent;
        for (let bodyIndex = child + 1; bodyIndex < lines.length; bodyIndex += 1) {
          const bodyLine = lines[bodyIndex];
          if (bodyLine.trim() && indentOf(bodyLine) <= parentIndent) break;
          body.push(bodyLine.slice(Math.min(bodyLine.length, parentIndent + 2)));
          child = bodyIndex;
        }
        scripts.push(body.join('\n'));
      } else if (value) {
        const unquoted = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
        scripts.push(unquoted);
      }
      break;
    }
  }
  return scripts;
};

const directPayload = (value: string) => /context\.payload\.(?:comment|issue|pull_request|review|discussion)(?:\.|\?\.)(?:body|title|diff_hunk|path)\b/.test(value);

const taintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const assignments: Array<[string, string]> = [];
  for (const match of script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) assignments.push([match[1], match[2]]);
  for (const match of script.matchAll(/(?:^|[;\n])\s*([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)) assignments.push([match[1], match[2]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, value] of assignments) {
      if (tainted.has(name)) continue;
      const identifier = value.trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1];
      if (directPayload(value) || (identifier && tainted.has(identifier))) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
};

const splitTopLevelArgs = (body: string) => {
  const args: string[] = [];
  let start = 0;
  let quote: '"' | "'" | '`' | null = null;
  let square = 0;
  let curly = 0;
  let paren = 0;
  let backslashes = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && backslashes % 2 === 0) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; backslashes = 0; continue; }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === ',' && square === 0 && curly === 0 && paren === 0) {
      args.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(body.slice(start).trim());
  return args;
};

const unquote = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(['"`])([\s\S]*)\1$/);
  return match ? match[2] : null;
};

const isTainted = (value: string, tainted: Set<string>) => {
  if (directPayload(value)) return true;
  const identifier = value.trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  return Boolean(identifier && tainted.has(identifier));
};

const codeFlagsFor = (executable: string) => {
  const basename = executable.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
  if (/^node(?:\.exe)?$/.test(basename)) return new Set(['-e', '--eval', '-p', '--print']);
  if (/^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/.test(basename)) return new Set(['-c']);
  if (/^ruby(?:\.exe)?$/.test(basename)) return new Set(['-e']);
  if (/^perl(?:\.exe)?$/.test(basename)) return new Set(['-e']);
  if (/^php(?:\.exe)?$/.test(basename)) return new Set(['-r']);
  return null;
};

const hasTaintedInterpreterCodeFlag = (script: string) => {
  const tainted = taintedIdentifiers(script);
  const call = /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(([^;\n]+)\)/g;
  for (const match of script.matchAll(call)) {
    const args = splitTopLevelArgs(match[1]);
    if (args.length < 2) continue;
    const executable = unquote(args[0]);
    if (!executable) continue;
    const codeFlags = codeFlagsFor(executable);
    if (!codeFlags) continue;
    const array = args[1].trim().match(/^\[([\s\S]*)\]$/);
    if (!array) continue;
    const argv = splitTopLevelArgs(array[1]);
    if (argv.length < 2) continue;
    const flag = unquote(argv[0]);
    if (!flag || !codeFlags.has(flag)) continue;
    if (isTainted(argv[1], tainted)) return true;
  }
  return false;
};

const expectNoTaintedInterpreterFlags = (workflow: string, source: string) => {
  for (const script of githubScriptBodies(workflow)) {
    expect(hasTaintedInterpreterCodeFlag(script), source).toBe(false);
  }
};

describe('GitHub Script interpreter code-flag policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) expectNoTaintedInterpreterFlags(readFileSync(join(workflowsDir, file), 'utf8'), file);
  });

  it('rejects commenter-controlled JavaScript passed to node -e', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        require('node:child_process').execFileSync('node', ['-e', context.payload.comment.body])",
    ].join('\n');
    expect(() => expectNoTaintedInterpreterFlags(unsafe, 'node-e.yml')).toThrow();
  });

  it('rejects commenter-controlled Python passed to python3 -c', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        require('node:child_process').execFileSync('python3', ['-c', context.payload.comment.body])",
    ].join('\n');
    expect(() => expectNoTaintedInterpreterFlags(unsafe, 'python-c.yml')).toThrow();
  });

  it('propagates local aliases into interpreter code flags', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |-',
      '        const code = context.payload.issue.body;',
      "        require('node:child_process').execFileSync('/usr/bin/node', ['--eval', code])",
    ].join('\n');
    expect(() => expectNoTaintedInterpreterFlags(unsafe, 'node-e-alias.yml')).toThrow();
  });

  it('allows constant interpreter code', () => {
    const safe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        require('node:child_process').execFileSync('python3', ['-c', 'print(1)'])",
    ].join('\n');
    expectNoTaintedInterpreterFlags(safe, 'interpreter-safe.yml');
  });
});
