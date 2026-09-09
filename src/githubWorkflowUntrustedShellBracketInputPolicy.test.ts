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
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

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

const unwrapScalar = (raw: string) => {
  const value = stripYamlComment(raw).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const extractJobBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs: string[] = [];
  let jobsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const trimmed = line.trim();
    const indent = indentOf(lines[index]);
    if (jobsIndent === null) {
      if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (trimmed && indent <= jobsIndent) break;
    if (!/^\s*(?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/.test(line) || indent <= jobsIndent) continue;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && indentOf(childLine) <= indent) break;
      block.push(childLine);
      index = child;
    }
    jobs.push(block.join('\n'));
  }
  return jobs;
};

type Edge = { caller: string; callee: string; args: Map<string, string> };

const extractEdges = (workflows: Map<string, string>) => {
  const edges: Edge[] = [];
  for (const [caller, workflow] of workflows) {
    for (const job of extractJobBlocks(workflow)) {
      const uses = job.match(/^\s*["']?uses["']?\s*:\s*(.+)$/m)?.[1];
      const callee = uses ? unwrapScalar(uses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1] : undefined;
      if (!callee) continue;
      const args = new Map<string, string>();
      const lines = job.split('\n');
      let withIndent: number | null = null;
      for (const rawLine of lines) {
        const trimmed = stripYamlComment(rawLine).trim();
        const indent = indentOf(rawLine);
        if (withIndent === null) {
          if (/^["']?with["']?\s*:\s*$/.test(trimmed)) withIndent = indent;
          continue;
        }
        if (trimmed && indent <= withIndent) break;
        const arg = stripYamlComment(rawLine).match(/^\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*:\s*(.+)$/);
        if (arg) args.set(arg[1], unwrapScalar(arg[2]));
      }
      edges.push({ caller, callee, args });
    }
  }
  return edges;
};

const inputReference = (value: string, input: string) => {
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`inputs(?:\\.${escaped}|\\[['"]${escaped}['"]\\])\\b`).test(value);
};

const assertNoBracketedReusableInputShell = (workflows: Map<string, string>) => {
  const tainted = new Map<string, Set<string>>([...workflows.keys()].map((name) => [name, new Set()]));
  const edges = extractEdges(workflows);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const callerTaint = tainted.get(edge.caller) ?? new Set<string>();
      const calleeTaint = tainted.get(edge.callee) ?? new Set<string>();
      for (const [argName, rawValue] of edge.args) {
        const value = normalizeAccess(rawValue);
        const inherited = [...callerTaint].some((input) => inputReference(value, input));
        if ((untrusted(value) || inherited) && !calleeTaint.has(argName)) {
          calleeTaint.add(argName);
          changed = true;
        }
      }
    }
  }

  for (const [workflowName, workflow] of workflows) {
    const workflowTaint = tainted.get(workflowName) ?? new Set<string>();
    for (const input of workflowTaint) {
      const normalized = normalizeAccess(workflow);
      const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const directRun = new RegExp(`run\\s*:[^\\n]*inputs\\.${escaped}\\b`, 'i');
      const envAssignment = new RegExp(`([A-Za-z_][A-Za-z0-9_]*)\\s*:\\s*[^\\n]*inputs\\.${escaped}\\b`, 'i').exec(normalized);
      expect(directRun.test(normalized), `${workflowName}: tainted reusable input ${input} reaches run`).toBe(false);
      if (envAssignment) {
        const envName = envAssignment[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(new RegExp(`run\\s*:[^\\n]*(?:\\$${envName}\\b|\\$\\{${envName}\\}|%${envName}%|\\$env:${envName}\\b)`, 'i').test(normalized), `${workflowName}: tainted reusable input ${input} reaches run through env`).toBe(false);
      }
    }
  }
};

describe('GitHub reusable workflow bracketed-input shell policy', () => {
  it('blocks bracketed input forwarding across nested reusable workflows', () => {
    const workflows = new Map<string, string>([
      ['a.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/b.yml', '    with:', '      command: ${{ github.event.comment.body }}'].join('\n')],
      ['b.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/c.yml', '    with:', "      command: ${{ inputs['command'] }}"].join('\n')],
      ['c.yml', ['jobs:', '  run:', '    steps:', '      - run: bash -c "${{ inputs.command }}"'].join('\n')],
    ]);
    expect(() => assertNoBracketedReusableInputShell(workflows)).toThrow();
  });

  it('checks every checked-in local reusable-workflow edge', () => {
    const workflows = new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));
    expect(workflows.size).toBeGreaterThan(0);
    assertNoBracketedReusableInputShell(workflows);
  });
});
