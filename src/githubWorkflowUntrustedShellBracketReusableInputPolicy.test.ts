import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[(?:'|")([A-Za-z_][A-Za-z0-9_-]*)(?:'|")\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/
    .test(normalizeAccess(value));

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripComment = (value: string) => {
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

const unwrap = (raw: string) => {
  const value = stripComment(raw).trim();
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

type Edge = { caller: string; callee: string; args: Map<string, string> };

const extractLocalReusableEdges = (workflows: Map<string, string>) => {
  const edges: Edge[] = [];
  for (const [caller, workflow] of workflows) {
    const lines = workflow.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const uses = stripComment(lines[index]).match(/^\s*uses\s*:\s*(.+)$/);
      if (!uses) continue;
      const target = unwrap(uses[1]).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1];
      if (!target) continue;

      const usesIndent = indentOf(lines[index]);
      const args = new Map<string, string>();
      let withIndent: number | null = null;
      for (let child = index + 1; child < lines.length; child += 1) {
        const raw = lines[child];
        const line = stripComment(raw);
        const trimmed = line.trim();
        const indent = indentOf(raw);
        if (trimmed && indent < usesIndent) break;
        if (withIndent === null) {
          if (/^with\s*:\s*$/.test(trimmed)) withIndent = indent;
          continue;
        }
        if (trimmed && indent <= withIndent) break;
        const arg = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
        if (arg) args.set(arg[1], unwrap(arg[2]));
      }
      edges.push({ caller, callee: target, args });
    }
  }
  return edges;
};

const referencesInput = (value: string, input: string) => {
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`inputs\\.${escaped}\\b`).test(normalizeAccess(value));
};

const expectNoBracketedReusableInputBypass = (workflows: Map<string, string>) => {
  const taintedInputs = new Map<string, Set<string>>(
    [...workflows.keys()].map((name) => [name, new Set<string>()]),
  );

  const edges = extractLocalReusableEdges(workflows);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const callerTaint = taintedInputs.get(edge.caller) ?? new Set<string>();
      const calleeTaint = taintedInputs.get(edge.callee) ?? new Set<string>();
      for (const [argName, value] of edge.args) {
        const inherited = [...callerTaint].some((input) => referencesInput(value, input));
        if ((isUntrusted(value) || inherited) && !calleeTaint.has(argName)) {
          calleeTaint.add(argName);
          changed = true;
        }
      }
      taintedInputs.set(edge.callee, calleeTaint);
    }
  }

  for (const [name, workflow] of workflows) {
    const tainted = taintedInputs.get(name) ?? new Set<string>();
    if (!tainted.size) continue;
    for (const rawLine of workflow.split('\n')) {
      const run = stripComment(rawLine).match(/^\s*(?:-\s*)?run\s*:\s*(.+)$/)?.[1];
      if (!run) continue;
      for (const input of tainted) {
        expect(referencesInput(run, input), `${name}: bracketed reusable input reaches run`).toBe(false);
      }
    }
  }
};

const checkedInWorkflows = () => new Map(
  workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]),
);

describe('GitHub workflow bracketed reusable-input shell policy', () => {
  it('rejects bracket notation while propagating taint through reusable workflows', () => {
    const workflows = new Map<string, string>([
      ['a.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/b.yml',
        '    with:',
        '      command: ${{ github.event.comment.body }}',
      ].join('\n')],
      ['b.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/c.yml',
        '    with:',
        "      command: ${{ inputs['command'] }}",
      ].join('\n')],
      ['c.yml', [
        'jobs:',
        '  execute:',
        '    steps:',
        '      - run: bash -c "${{ inputs[\\"command\\"] }}"',
      ].join('\n')],
    ]);

    expect(() => expectNoBracketedReusableInputBypass(workflows)).toThrow();
  });

  it('allows bracket notation when the propagated value is a literal', () => {
    const workflows = new Map<string, string>([
      ['a.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/b.yml',
        '    with:',
        '      command: echo-safe',
      ].join('\n')],
      ['b.yml', [
        'jobs:',
        '  execute:',
        '    steps:',
        "      - run: echo ${{ inputs['command'] }}",
      ].join('\n')],
    ]);

    expect(() => expectNoBracketedReusableInputBypass(workflows)).not.toThrow();
  });

  it('enforces the bracket-normalized reusable-input boundary across checked-in workflows', () => {
    const workflows = checkedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);
    expectNoBracketedReusableInputBypass(workflows);
  });
});
