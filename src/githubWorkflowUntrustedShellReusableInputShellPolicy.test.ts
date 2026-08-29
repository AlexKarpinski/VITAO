import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

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

const containsUntrustedSource = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.(?:body|path|diff_hunk)|pull_request\.(?:title|body|head\.(?:ref|label))|discussion\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const extractJobBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const blocks: string[] = [];
  let jobsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const trimmed = line.trim();
    const indent = getIndent(raw);
    if (jobsIndent === null) {
      if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (trimmed && indent <= jobsIndent) break;
    if (!/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/.test(line) || indent <= jobsIndent) continue;

    const block = [raw];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childRaw = lines[child];
      const childTrimmed = childRaw.trim();
      const childIndent = getIndent(childRaw);
      if (childTrimmed && childIndent <= indent) break;
      block.push(childRaw);
      index = child;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

type Edge = { caller: string; callee: string; args: Map<string, string> };

const extractEdges = (workflows: Map<string, string>) => {
  const edges: Edge[] = [];
  for (const [caller, workflow] of workflows) {
    for (const job of extractJobBlocks(workflow)) {
      const rawUses = job.match(/^\s*["']?uses["']?\s*:\s*(.+)$/m)?.[1];
      if (!rawUses) continue;
      const callee = unwrapScalar(rawUses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1];
      if (!callee) continue;

      const args = new Map<string, string>();
      const lines = job.split('\n');
      let withIndent: number | null = null;
      for (const raw of lines) {
        const line = stripYamlComment(raw);
        const trimmed = line.trim();
        const indent = getIndent(raw);
        if (withIndent === null) {
          if (/^["']?with["']?\s*:\s*$/.test(trimmed)) withIndent = indent;
          continue;
        }
        if (trimmed && indent <= withIndent) break;
        const arg = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
        if (arg) args.set(arg[1], unwrapScalar(arg[2]));
      }
      edges.push({ caller, callee, args });
    }
  }
  return edges;
};

const expectNoReusableInputShellTemplateBypass = (workflows: Map<string, string>) => {
  const taintedInputs = new Map<string, Set<string>>();
  for (const name of workflows.keys()) taintedInputs.set(name, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of extractEdges(workflows)) {
      const callerTaint = taintedInputs.get(edge.caller) ?? new Set<string>();
      const calleeTaint = taintedInputs.get(edge.callee) ?? new Set<string>();
      for (const [name, value] of edge.args) {
        const normalized = normalizeAccess(value);
        const inherited = [...callerTaint].some((input) => new RegExp(`inputs\\.${input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalized));
        if ((containsUntrustedSource(normalized) || inherited) && !calleeTaint.has(name)) {
          calleeTaint.add(name);
          changed = true;
        }
      }
      taintedInputs.set(edge.callee, calleeTaint);
    }
  }

  for (const [name, workflow] of workflows) {
    const inputs = taintedInputs.get(name) ?? new Set<string>();
    if (!inputs.size) continue;
    const shells = workflow.split('\n')
      .map((line) => stripYamlComment(line).match(/^\s*(?:-\s*)?["']?shell["']?\s*:\s*(.+)$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(unwrapScalar);
    for (const shell of shells) {
      const normalized = normalizeAccess(shell);
      for (const input of inputs) {
        const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(new RegExp(`inputs\\.${escaped}\\b`).test(normalized), `${name}: tainted reusable input reaches shell template`).toBe(false);
      }
    }
  }
};

const readWorkflows = () => new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));

describe('GitHub reusable-workflow input shell-template policy', () => {
  it('enforces the reusable-input boundary across checked-in workflows', () => {
    expectNoReusableInputShellTemplateBypass(readWorkflows());
  });

  it('rejects an untrusted reusable input used as the callee shell template', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/callee.yml', '    with:', '      executor: ${{ github.event.comment.body }}'].join('\n')],
      ['callee.yml', ['jobs:', '  execute:', '    steps:', '      - shell: ${{ inputs.executor }} {0}', '        run: echo safe'].join('\n')],
    ]);
    expect(() => expectNoReusableInputShellTemplateBypass(workflows)).toThrow();
  });

  it('allows a constant reusable input in a shell template', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/callee.yml', '    with:', '      executor: bash'].join('\n')],
      ['callee.yml', ['jobs:', '  execute:', '    steps:', '      - shell: ${{ inputs.executor }} {0}', '        run: echo safe'].join('\n')],
    ]);
    expect(() => expectNoReusableInputShellTemplateBypass(workflows)).not.toThrow();
  });
});