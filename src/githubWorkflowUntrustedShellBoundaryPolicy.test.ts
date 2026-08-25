import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};

const untrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(value);

const extractTaintedEnv = (workflow: string) => {
  const tainted = new Set<string>();
  for (const line of workflow.split('\n')) {
    const match = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.+)$/);
    if (!match) continue;
    const key = normalizeKey(match[1]);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && untrusted(match[2])) tainted.add(key);
  }
  return tainted;
};

const shellReferencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const expectNoQuotedEnvOrCmdBypass = (workflow: string) => {
  const tainted = extractTaintedEnv(workflow);
  const runScripts = workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value));

  for (const script of runScripts) {
    for (const name of tainted) {
      expect(shellReferencesEnv(script, name), `run executes tainted env ${name}`).toBe(false);
    }
  }
};

const expectNoCrossJobOutputBypass = (workflow: string) => {
  const taintedStepIds = new Set<string>();
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const idMatch = lines[index].match(/^\s*(?:-\s*)?id\s*:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/);
    if (!idMatch) continue;
    const block = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
    if (untrusted(block)) taintedStepIds.add(idMatch[1]);
  }

  const taintedJobOutputs = new Set<string>();
  for (const line of lines) {
    const output = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z_][A-Za-z0-9_-]*\s*\}\}\s*$/);
    if (output && taintedStepIds.has(output[2])) taintedJobOutputs.add(output[1]);
  }

  const taintedConsumerEnv = new Set<string>();
  for (const line of lines) {
    const env = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*\$\{\{\s*needs\.[A-Za-z_][A-Za-z0-9_-]*\.outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}\s*$/);
    if (env && taintedJobOutputs.has(env[2])) taintedConsumerEnv.add(normalizeKey(env[1]));
  }

  for (const line of lines) {
    const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1];
    if (!run) continue;
    for (const outputName of taintedJobOutputs) {
      expect(new RegExp(`\\$\\{\\{\\s*needs\\.[A-Za-z_][A-Za-z0-9_-]*\\.outputs\\.${outputName}\\s*\\}\\}`).test(run)).toBe(false);
    }
    for (const envName of taintedConsumerEnv) {
      expect(shellReferencesEnv(run, envName), `run executes env ${envName} tainted by a job output`).toBe(false);
    }
  }
};

const expectNoReusableWorkflowInputBypass = (caller: string, callee: string) => {
  const taintedInputs = new Set<string>();
  for (const line of caller.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(\$\{\{[^}]+\}\})\s*$/);
    if (match && untrusted(match[2])) taintedInputs.add(match[1]);
  }

  const taintedCalleeEnv = new Set<string>();
  for (const line of callee.split('\n')) {
    const env = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}\s*$/);
    if (env && taintedInputs.has(env[2])) taintedCalleeEnv.add(normalizeKey(env[1]));
  }

  for (const line of callee.split('\n')) {
    const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1];
    if (!run) continue;
    for (const input of taintedInputs) {
      expect(new RegExp(`\\$\\{\\{\\s*inputs\\.${input}\\s*\\}\\}`).test(run)).toBe(false);
    }
    for (const envName of taintedCalleeEnv) {
      expect(shellReferencesEnv(run, envName), `run executes env ${envName} tainted by reusable-workflow input`).toBe(false);
    }
  }
};

const readCheckedInWorkflows = () =>
  new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));

describe('GitHub workflow untrusted shell boundary policy', () => {
  it('enforces boundary checks across every checked-in workflow and local reusable-workflow edge', () => {
    const workflows = readCheckedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);

    for (const workflow of workflows.values()) {
      expectNoQuotedEnvOrCmdBypass(workflow);
      expectNoCrossJobOutputBypass(workflow);
    }

    for (const [callerName, caller] of workflows) {
      for (const match of caller.matchAll(/uses\s*:\s*["']?\.\/\.github\/workflows\/([^\s#"']+)["']?/g)) {
        const calleeName = match[1];
        const callee = workflows.get(calleeName);
        expect(callee, `${callerName} references missing local reusable workflow ${calleeName}`).toBeDefined();
        expectNoReusableWorkflowInputBypass(caller, callee!);
      }
    }
  });

  it('rejects quoted tainted env keys executed by cmd.exe percent expansion', () => {
    const unsafe = [
      'env:',
      '  "CMD": ${{ github.event.comment.body }}',
      'steps:',
      '  - shell: cmd',
      '    run: call %CMD%',
    ].join('\n');

    expect(() => expectNoQuotedEnvOrCmdBypass(unsafe)).toThrow();
  });

  it('rejects tainted step outputs propagated through job outputs and needs', () => {
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
      '      - run: bash -c "${{ needs.producer.outputs.command }}"',
    ].join('\n');

    expect(() => expectNoCrossJobOutputBypass(unsafe)).toThrow();
  });

  it('rejects job-output taint routed through consumer env', () => {
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
      '    env:',
      '      CMD: ${{ needs.producer.outputs.command }}',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoCrossJobOutputBypass(unsafe)).toThrow();
  });

  it('rejects untrusted caller values executed through reusable-workflow inputs', () => {
    const caller = [
      'jobs:',
      '  delegate:',
      '    uses: ./.github/workflows/reusable.yml',
      '    with:',
      '      command: ${{ github.event.comment.body }}',
    ].join('\n');
    const callee = [
      'on:',
      '  workflow_call:',
      '    inputs:',
      '      command:',
      '        type: string',
      'jobs:',
      '  execute:',
      '    steps:',
      '      - run: bash -c "${{ inputs.command }}"',
    ].join('\n');

    expect(() => expectNoReusableWorkflowInputBypass(caller, callee)).toThrow();
  });

  it('rejects quoted reusable-workflow references and input taint routed through callee env', () => {
    const caller = [
      'jobs:',
      '  delegate:',
      '    uses: "./.github/workflows/reusable.yml"',
      '    with:',
      '      command: ${{ github.event.comment.body }}',
    ].join('\n');
    const callee = [
      'on:',
      '  workflow_call:',
      '    inputs:',
      '      command:',
      '        type: string',
      'jobs:',
      '  execute:',
      '    env:',
      '      CMD: ${{ inputs.command }}',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');

    expect(caller).toMatch(/uses\s*:\s*["']?\.\/\.github\/workflows\/([^\s#"']+)["']?/);
    expect(() => expectNoReusableWorkflowInputBypass(caller, callee)).toThrow();
  });

  it('allows safe literal values across the same boundaries', () => {
    const safeEnv = 'env:\n  "CMD": echo-safe\nsteps:\n  - shell: cmd\n    run: call %CMD%';
    expect(() => expectNoQuotedEnvOrCmdBypass(safeEnv)).not.toThrow();

    const caller = 'jobs:\n  delegate:\n    uses: ./.github/workflows/reusable.yml\n    with:\n      command: echo-safe';
    const callee = 'jobs:\n  execute:\n    steps:\n      - run: bash -c "${{ inputs.command }}"';
    expect(() => expectNoReusableWorkflowInputBypass(caller, callee)).not.toThrow();
  });
});
