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

const containsWorkflowRunTitle = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /(?:context\.payload|github\.event)\.workflow_run\.display_title\b/.test(normalized);
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
      if (!containsWorkflowRunTitle(expression) && !referencesTainted) continue;
      tainted.add(name);
      changed = true;
    }
  }

  return tainted;
};

const containsTaintedValue = (value: string, tainted: Set<string>) =>
  containsWorkflowRunTitle(value)
  || [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

type Call = { name: string; args: string };
type Quote = "'" | '"' | '`' | null;

const extractCalls = (script: string, names: string[]): Call[] => {
  const calls: Call[] = [];
  const matcher = new RegExp(`\\b(${names.join('|')})\\s*(?:\\?\\.\\s*)?\\(`, 'g');

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
      calls.push({ name: match[1], args: script.slice(open + 1, index) });
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

const shellExecutable = /^(?:\/bin\/)?(?:bash|sh|dash|ksh|zsh)$/i;
const unquoteLiteral = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.includes('${'))
  ) {
    return trimmed.slice(1, -1);
  }
  return null;
};

const hasWorkflowRunTitleShellExecution = (script: string) => {
  const tainted = collectTaintedIdentifiers(script);
  const calls = extractCalls(script, ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']);

  for (const call of calls) {
    const args = splitTopLevelArgs(call.args);
    const command = args[0] ?? '';

    if (call.name === 'exec' || call.name === 'execSync') {
      if (containsTaintedValue(command, tainted)) return true;
      continue;
    }

    const executable = unquoteLiteral(command);
    if (!executable || !shellExecutable.test(executable)) continue;
    const shellArgs = args[1] ?? '';
    if (/['"]-c['"]/.test(shellArgs) && containsTaintedValue(shellArgs, tainted)) return true;
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

const expectNoWorkflowRunTitleShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasWorkflowRunTitleShellExecution(script),
      `${source}: GitHub Script executes a workflow_run display title through a shell API`,
    ).toBe(false);
  }
};

describe('GitHub Script workflow_run title trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoWorkflowRunTitleShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct execution of a workflow-run display title', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.workflow_run.display_title);",
    ].join('\n');

    expect(() => expectNoWorkflowRunTitleShellExecution(unsafe, 'workflow-run-title.yml')).toThrow();
  });

  it('rejects an aliased workflow-run display title passed to an explicit shell', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const title = github.event.workflow_run.display_title;',
      "            require('node:child_process').spawnSync('bash', ['-c', title]);",
    ].join('\n');

    expect(() => expectNoWorkflowRunTitleShellExecution(unsafe, 'workflow-run-title-alias.yml')).toThrow();
  });

  it('allows a workflow-run display title when it is used only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.workflow_run.display_title);',
      "            require('node:child_process').execSync('printf safe');",
    ].join('\n');

    expectNoWorkflowRunTitleShellExecution(safe, 'workflow-run-title-data.yml');
  });
});
