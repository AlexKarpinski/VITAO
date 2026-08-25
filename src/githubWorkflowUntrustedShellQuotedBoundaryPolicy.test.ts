import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const unwrapQuotedScalar = (raw: string) => {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
};

const normalizeKey = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const untrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(value);

const shellReferencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const expectNoQuotedJobOutputEnvBypass = (workflow: string) => {
  const lines = workflow.split('\n');
  const taintedStepIds = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].match(/^\s*(?:-\s*)?id\s*:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/)?.[1];
    if (!id) continue;
    if (untrusted(lines.slice(index, Math.min(lines.length, index + 12)).join('\n'))) taintedStepIds.add(id);
  }

  const taintedOutputs = new Set<string>();
  for (const line of lines) {
    const output = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z_][A-Za-z0-9_-]*\s*\}\}\s*$/);
    if (output && taintedStepIds.has(output[2])) taintedOutputs.add(output[1]);
  }

  const taintedEnv = new Set<string>();
  for (const line of lines) {
    const env = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.+)$/);
    if (!env) continue;
    const value = unwrapQuotedScalar(env[2]);
    const output = value.match(/^\$\{\{\s*needs\.[A-Za-z_][A-Za-z0-9_-]*\.outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/);
    if (output && taintedOutputs.has(output[1])) taintedEnv.add(normalizeKey(env[1]));
  }

  for (const line of lines) {
    const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1];
    if (!run) continue;
    for (const name of taintedEnv) expect(shellReferencesEnv(run, name), `run executes env ${name} tainted by quoted job output`).toBe(false);
  }
};

const expectNoQuotedReusableEnvBypass = (caller: string, callee: string) => {
  const taintedInputs = new Set<string>();
  for (const line of caller.split('\n')) {
    const input = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (input && untrusted(unwrapQuotedScalar(input[2]))) taintedInputs.add(input[1]);
  }

  const taintedEnv = new Set<string>();
  for (const line of callee.split('\n')) {
    const env = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.+)$/);
    if (!env) continue;
    const value = unwrapQuotedScalar(env[2]);
    const input = value.match(/^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/);
    if (input && taintedInputs.has(input[1])) taintedEnv.add(normalizeKey(env[1]));
  }

  for (const line of callee.split('\n')) {
    const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1];
    if (!run) continue;
    for (const name of taintedEnv) expect(shellReferencesEnv(run, name), `run executes env ${name} tainted by quoted reusable input`).toBe(false);
  }
};

const readCheckedInWorkflows = () => new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));

describe('GitHub workflow quoted boundary taint policy', () => {
  it('enforces quoted boundary values across checked-in workflows', () => {
    const workflows = readCheckedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);
    for (const workflow of workflows.values()) expectNoQuotedJobOutputEnvBypass(workflow);
    for (const [callerName, caller] of workflows) {
      for (const match of caller.matchAll(/uses\s*:\s*["']?\.\/\.github\/workflows\/([^\s#"']+)["']?/g)) {
        const callee = workflows.get(match[1]);
        expect(callee, `${callerName} references missing local reusable workflow ${match[1]}`).toBeDefined();
        expectNoQuotedReusableEnvBypass(caller, callee!);
      }
    }
  });

  it('rejects quoted consumer env values carrying tainted job outputs', () => {
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
      '      CMD: "${{ needs.producer.outputs.command }}"',
      '    steps:',
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoQuotedJobOutputEnvBypass(unsafe)).toThrow();
  });

  it('rejects quoted callee env values carrying tainted reusable inputs', () => {
    const caller = 'jobs:\n  delegate:\n    uses: "./.github/workflows/reusable.yml"\n    with:\n      command: ${{ github.event.comment.body }}';
    const callee = 'jobs:\n  execute:\n    env:\n      CMD: "${{ inputs.command }}"\n    steps:\n      - run: bash -c "$CMD"';
    expect(() => expectNoQuotedReusableEnvBypass(caller, callee)).toThrow();
  });
});
