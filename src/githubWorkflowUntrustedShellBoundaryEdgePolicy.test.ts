import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const untrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/
    .test(normalizeAccess(value));

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && (quote === "'" || value[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const unwrapScalar = (value: string) => {
  const clean = stripYamlComment(value).trim();
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) return clean.slice(1, -1);
  return clean;
};

const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const collectScalar = (lines: string[], start: number, parentIndent: number) => {
  const body: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentOf(line) <= parentIndent) break;
    body.push(line.trim());
    end = index;
  }
  return { value: body.join('\n'), end };
};

const expectNoBracketedNeedsRun = (workflow: string) => {
  const normalized = normalizeAccess(workflow);
  const taintedOutputs = new Set<string>();
  for (const match of normalized.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z_][A-Za-z0-9_-]*\s*\}\}\s*$/gm)) {
    const outputName = match[1];
    const stepId = match[2];
    const stepPattern = new RegExp(`id:\\s*["']?${stepId}["']?[\\s\\S]{0,1600}?(?:github\\.event|context\\.payload)`);
    if (stepPattern.test(normalized)) taintedOutputs.add(outputName);
  }
  for (const output of taintedOutputs) {
    const escaped = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const run = new RegExp(`run:[^\\n]*needs\\.[A-Za-z_][A-Za-z0-9_-]*\\.outputs\\.${escaped}\\b`);
    expect(run.test(normalized), `tainted job output ${output} reaches run`).toBe(false);
  }
};

type ReusableCall = { path: string; args: Array<{ name: string; value: string }> };

const collectReusableCalls = (workflow: string): ReusableCall[] => {
  const calls: ReusableCall[] = [];
  const lines = workflow.split('\n');
  let call: ReusableCall | null = null;
  let jobIndent: number | null = null;
  let withIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const indent = indentOf(raw);
    const uses = line.match(/^\s*uses:\s*(.+?)\s*$/);
    const path = uses ? unwrapScalar(uses[1]) : '';
    if (path.startsWith('./.github/workflows/')) {
      call = { path: path.slice('./.github/workflows/'.length), args: [] };
      calls.push(call);
      jobIndent = indent;
      withIndent = null;
      continue;
    }
    if (!call) continue;
    if (line.trim() && jobIndent !== null && indent <= jobIndent && !/^\s*with:\s*$/.test(line)) {
      call = null;
      jobIndent = null;
      withIndent = null;
      continue;
    }
    if (withIndent === null) {
      if (/^\s*with:\s*$/.test(line)) withIndent = indent;
      continue;
    }
    if (line.trim() && indent <= withIndent) {
      withIndent = null;
      continue;
    }
    const entry = line.match(/^\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*(.*)$/);
    if (!entry) continue;
    const name = entry[1];
    const value = entry[2].trim();
    if (scalarHeader.test(value)) {
      const scalar = collectScalar(lines, index, indent);
      call.args.push({ name, value: scalar.value });
      index = scalar.end;
    } else {
      call.args.push({ name, value: unwrapScalar(value) });
    }
  }
  return calls;
};

const collectRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const match = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (scalarHeader.test(value)) {
      const scalar = collectScalar(lines, index, indentOf(raw));
      scripts.push(scalar.value);
      index = scalar.end;
    } else {
      scripts.push(unwrapScalar(value));
    }
  }
  return scripts;
};

const calleeRunsInput = (callee: string, inputName: string) => {
  const escaped = inputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inputPattern = new RegExp(`inputs\\.${escaped}\\b`);
  return collectRunScripts(normalizeAccess(callee)).some((script) => inputPattern.test(script));
};

const expectNoUntrustedReusableShellArgs = (workflow: string, callees: Map<string, string>) => {
  for (const call of collectReusableCalls(workflow)) {
    const callee = callees.get(call.path);
    if (!callee) continue;
    for (const arg of call.args) {
      if (!untrusted(arg.value)) continue;
      expect(calleeRunsInput(callee, arg.name), `untrusted ${arg.name} reaches shell in ${call.path}`).toBe(false);
    }
  }
};

describe('GitHub workflow boundary edge policy', () => {
  it('enforces bracketed needs and reusable shell boundaries across checked-in workflows', () => {
    const callees = new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));
    for (const name of workflowFiles) {
      const workflow = callees.get(name)!;
      expectNoBracketedNeedsRun(workflow);
      expectNoUntrustedReusableShellArgs(workflow, callees);
    }
  });

  it('rejects bracketed needs access for a tainted producer output', () => {
    const unsafe = [
      'jobs:',
      '  producer:',
      '    outputs:',
      '      command: ${{ steps.capture.outputs.result }}',
      '    steps:',
      '      - id: capture',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: return context.payload.comment.body',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      `      - run: bash -c "\${{ needs['producer'].outputs.command }}"`,
    ].join('\n');
    expect(() => expectNoBracketedNeedsRun(unsafe)).toThrow();
  });

  it('rejects an untrusted reusable argument only when the callee executes that input in shell', () => {
    const caller = [
      'jobs:',
      '  call:',
      '    uses: ./.github/workflows/reusable.yml',
      '    with:',
      '      command: >-',
      '        ${{ github.event.comment.body }}',
    ].join('\n');
    const unsafeCallee = ['on: workflow_call', 'jobs:', '  work:', '    steps:', '      - run: bash -c "${{ inputs.command }}"'].join('\n');
    expect(() => expectNoUntrustedReusableShellArgs(caller, new Map([['reusable.yml', unsafeCallee]]))).toThrow();

    const safeCallee = [
      'on: workflow_call',
      'jobs:',
      '  work:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: console.log(context.payload)',
    ].join('\n');
    expectNoUntrustedReusableShellArgs(caller, new Map([['reusable.yml', safeCallee]]));
  });
});
