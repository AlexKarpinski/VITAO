import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && (quote === "'" || value[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const unwrapScalar = (raw: string) => {
  const value = stripYamlComment(raw).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

const blockHeader = /^[|>](?:(?:[1-9][+-]?)|(?:[+-][1-9]?)|[+-])?$/;

const collectIndentedValue = (lines: string[], start: number, keyIndent: number) => {
  const value: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() && getIndent(raw) <= keyIndent) break;
    value.push(raw.trim());
    end = index;
  }
  return { value: value.join('\n'), end };
};

const collectJobs = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs: string[] = [];
  let jobsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const indent = getIndent(lines[index]);
    const trimmed = line.trim();
    if (jobsIndent === null) {
      if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (trimmed && indent <= jobsIndent) break;
    if (!/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/.test(line) || indent <= jobsIndent) continue;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && getIndent(childLine) <= indent) break;
      block.push(childLine);
      index = child;
    }
    jobs.push(block.join('\n'));
  }
  return jobs;
};

type Edge = { caller: string; callee: string; args: Map<string, string> };

const collectReusableEdges = (workflows: Map<string, string>) => {
  const edges: Edge[] = [];
  for (const [caller, workflow] of workflows) {
    for (const job of collectJobs(workflow)) {
      const uses = job.match(/^\s*["']?uses["']?\s*:\s*(.+)$/m)?.[1];
      const callee = uses ? unwrapScalar(uses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1] : undefined;
      if (!callee) continue;

      const lines = job.split('\n');
      const args = new Map<string, string>();
      let withIndent: number | null = null;
      for (let index = 0; index < lines.length; index += 1) {
        const raw = lines[index];
        const line = stripYamlComment(raw);
        const trimmed = line.trim();
        const indent = getIndent(raw);
        if (withIndent === null) {
          if (/^["']?with["']?\s*:\s*$/.test(trimmed)) withIndent = indent;
          continue;
        }
        if (trimmed && indent <= withIndent) break;
        const arg = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
        if (!arg) continue;
        const rawValue = unwrapScalar(arg[2]);
        if (blockHeader.test(rawValue)) {
          const collected = collectIndentedValue(lines, index, indent);
          args.set(arg[1], collected.value);
          index = collected.end;
        } else {
          args.set(arg[1], rawValue);
        }
      }
      edges.push({ caller, callee, args });
    }
  }
  return edges;
};

const collectRunValues = (workflow: string) => {
  const lines = workflow.split('\n');
  const runs: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const match = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/);
    if (!match) continue;
    const value = unwrapScalar(match[1]);
    if (blockHeader.test(value)) {
      const collected = collectIndentedValue(lines, index, getIndent(raw));
      runs.push(collected.value);
      index = collected.end;
    } else {
      runs.push(value);
    }
  }
  return runs;
};

const expectNoBlockScalarReusableInputBypass = (workflows: Map<string, string>) => {
  const edges = collectReusableEdges(workflows);
  const taintedInputs = new Map<string, Set<string>>();
  for (const name of workflows.keys()) taintedInputs.set(name, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const callerInputs = taintedInputs.get(edge.caller) ?? new Set<string>();
      const calleeInputs = taintedInputs.get(edge.callee) ?? new Set<string>();
      for (const [name, rawValue] of edge.args) {
        const value = normalizeAccess(rawValue);
        const inherited = [...callerInputs].some((input) => new RegExp(`inputs\\.${input}\\b`).test(value));
        if ((isUntrusted(value) || inherited) && !calleeInputs.has(name)) {
          calleeInputs.add(name);
          changed = true;
        }
      }
      taintedInputs.set(edge.callee, calleeInputs);
    }
  }

  for (const [name, workflow] of workflows) {
    const inputs = taintedInputs.get(name) ?? new Set<string>();
    for (const input of inputs) {
      const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sink = new RegExp(`inputs\\.${escaped}\\b`);
      for (const run of collectRunValues(workflow)) {
        expect(sink.test(normalizeAccess(run)), `${name}: tainted block-scalar reusable input reaches run`).toBe(false);
      }
    }
  }
};

const readCheckedInWorkflows = () => new Map(
  workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]),
);

describe('GitHub reusable-workflow block-scalar input shell policy', () => {
  it('rejects an untrusted block-scalar argument executed by the callee', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/callee.yml',
        '    with:',
        '      command: >-',
        '        ${{ github.event.comment.body }}',
      ].join('\n')],
      ['callee.yml', [
        'jobs:',
        '  execute:',
        '    steps:',
        '      - run: bash -c "${{ inputs.command }}"',
      ].join('\n')],
    ]);
    expect(() => expectNoBlockScalarReusableInputBypass(workflows)).toThrow();
  });

  it('allows a literal block-scalar argument', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/callee.yml',
        '    with:',
        '      command: >-',
        '        echo safe',
      ].join('\n')],
      ['callee.yml', [
        'jobs:',
        '  execute:',
        '    steps:',
        '      - run: bash -c "${{ inputs.command }}"',
      ].join('\n')],
    ]);
    expect(() => expectNoBlockScalarReusableInputBypass(workflows)).not.toThrow();
  });

  it('enforces the guard across checked-in reusable workflows', () => {
    const workflows = readCheckedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);
    expectNoBlockScalarReusableInputBypass(workflows);
  });
});
