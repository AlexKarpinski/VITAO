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
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
};

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

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const untrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

const shellReferencesEnv = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i').test(script);
};

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const collectIndentedBlock = (lines: string[], start: number, indent: number) => {
  const block = [lines[start]];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) <= indent) break;
    block.push(line);
    end = index;
  }
  return { block: block.join('\n'), end };
};

const extractJobs = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs = new Map<string, string>();
  let jobsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const trimmed = line.trim();
    const indent = getIndent(lines[index]);
    if (jobsIndent === null) {
      if (/^["']?jobs["']?\s*:\s*$/.test(trimmed)) jobsIndent = indent;
      continue;
    }
    if (trimmed && indent <= jobsIndent) break;
    const job = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    if (!job || indent <= jobsIndent) continue;
    const { block, end } = collectIndentedBlock(lines, index, indent);
    jobs.set(normalizeKey(job[1]), block);
    index = end;
  }
  return jobs;
};

const collectStepBlocks = (job: string) => {
  const lines = job.split('\n');
  const blocks: string[] = [];
  let stepsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const trimmed = line.trim();
    const indent = getIndent(lines[index]);
    if (stepsIndent === null) {
      if (/^["']?steps["']?\s*:\s*$/.test(trimmed)) stepsIndent = indent;
      continue;
    }
    if (trimmed && indent <= stepsIndent) break;
    if (!/^\s*-\s+/.test(line) || indent <= stepsIndent) continue;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childTrimmed = childLine.trim();
      const childIndent = getIndent(childLine);
      if (childTrimmed && childIndent === indent && /^\s*-\s+/.test(childLine)) break;
      if (childTrimmed && childIndent < indent) break;
      block.push(childLine);
      index = child;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

const extractTaintedStepIds = (job: string) => {
  const ids = new Set<string>();
  for (const block of collectStepBlocks(job)) {
    const rawId = block.match(/^\s*(?:-\s*)?["']?id["']?\s*:\s*(.+?)\s*$/m)?.[1];
    const id = rawId ? unwrapScalar(rawId) : undefined;
    if (id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) && untrusted(block)) ids.add(id);
  }
  return ids;
};

const extractTaintedEnv = (scope: string, additionalTaint: RegExp[] = []) => {
  const tainted = new Set<string>();
  const entries: Array<{ name: string; value: string }> = [];
  for (const rawLine of scope.split('\n')) {
    const line = stripYamlComment(rawLine);
    const match = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_]*))\s*:\s*(.+)$/);
    if (!match) continue;
    const name = normalizeKey(match[1]);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) entries.push({ name, value: unwrapScalar(match[2]) });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, value } of entries) {
      if (tainted.has(name)) continue;
      if (untrusted(value) || additionalTaint.some((pattern) => pattern.test(value)) || [...tainted].some((other) => shellReferencesEnv(value, other))) {
        tainted.add(name);
        changed = true;
      }
    }
  }
  return tainted;
};

const extractRunValues = (scope: string) => scope.split('\n')
  .map((line) => stripYamlComment(line).match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1])
  .filter((value): value is string => Boolean(value));

const expectNoQuotedEnvOrCmdBypass = (workflow: string) => {
  const jobs = extractJobs(workflow);
  const scopes = jobs.size ? [...jobs.values()] : [workflow];
  for (const scope of scopes) {
    const tainted = extractTaintedEnv(scope);
    for (const script of extractRunValues(scope)) {
      for (const name of tainted) expect(shellReferencesEnv(script, name), `run executes tainted env ${name}`).toBe(false);
    }
  }
};

const expectNoCrossJobOutputBypass = (workflow: string) => {
  const jobs = extractJobs(workflow);
  const taintedOutputs = new Set<string>();
  for (const [jobName, job] of jobs) {
    const taintedStepIds = extractTaintedStepIds(job);
    for (const rawLine of job.split('\n')) {
      const line = stripYamlComment(rawLine);
      const output = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+)$/);
      if (!output) continue;
      const outputName = normalizeKey(output[1]);
      const value = unwrapScalar(output[2]);
      for (const stepId of taintedStepIds) {
        const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`steps\\.${escaped}\\.outputs(?:\\.|\\[)`).test(value)) taintedOutputs.add(`${jobName}.${outputName}`);
      }
    }
  }

  for (const [jobName, job] of jobs) {
    const patterns = [...taintedOutputs].map((key) => {
      const [producer, output] = key.split('.');
      return new RegExp(`needs\\.${producer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.outputs\\.${output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    });
    const taintedEnv = extractTaintedEnv(job, patterns);
    for (const run of extractRunValues(job)) {
      for (const pattern of patterns) expect(pattern.test(run), `${jobName}: tainted job output reaches run`).toBe(false);
      for (const envName of taintedEnv) expect(shellReferencesEnv(run, envName), `${jobName}: run executes env ${envName} tainted by a job output`).toBe(false);
    }
  }
};

type WorkflowEdge = { caller: string; callee: string; args: Map<string, string> };

const extractReusableEdges = (workflows: Map<string, string>) => {
  const edges: WorkflowEdge[] = [];
  for (const [callerName, workflow] of workflows) {
    for (const job of extractJobs(workflow).values()) {
      const uses = job.match(/^\s*["']?uses["']?\s*:\s*(.+)$/m)?.[1];
      if (!uses) continue;
      const target = unwrapScalar(uses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1];
      if (!target) continue;
      const args = new Map<string, string>();
      const lines = job.split('\n');
      let withIndent: number | null = null;
      for (const rawLine of lines) {
        const line = stripYamlComment(rawLine);
        const trimmed = line.trim();
        const indent = getIndent(rawLine);
        if (withIndent === null) {
          if (/^["']?with["']?\s*:\s*$/.test(trimmed)) withIndent = indent;
          continue;
        }
        if (trimmed && indent <= withIndent) break;
        const arg = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+)$/);
        if (arg) args.set(normalizeKey(arg[1]), unwrapScalar(arg[2]));
      }
      edges.push({ caller: callerName, callee: target, args });
    }
  }
  return edges;
};

const expectNoReusableWorkflowInputBypass = (workflows: Map<string, string>) => {
  const edges = extractReusableEdges(workflows);
  const taintedInputs = new Map<string, Set<string>>();
  for (const name of workflows.keys()) taintedInputs.set(name, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const callerTaint = taintedInputs.get(edge.caller) ?? new Set<string>();
      const calleeTaint = taintedInputs.get(edge.callee) ?? new Set<string>();
      for (const [argName, value] of edge.args) {
        const inherited = [...callerTaint].some((input) => new RegExp(`inputs\\.${input}\\b`).test(value));
        if ((untrusted(value) || inherited) && !calleeTaint.has(argName)) {
          calleeTaint.add(argName);
          changed = true;
        }
      }
      taintedInputs.set(edge.callee, calleeTaint);
    }
  }

  for (const [workflowName, workflow] of workflows) {
    const inputs = taintedInputs.get(workflowName) ?? new Set<string>();
    if (!inputs.size) continue;
    const inputPatterns = [...inputs].map((input) => new RegExp(`inputs\\.${input}\\b`));
    const taintedEnv = extractTaintedEnv(workflow, inputPatterns);
    for (const run of extractRunValues(workflow)) {
      for (const pattern of inputPatterns) expect(pattern.test(run), `${workflowName}: tainted reusable input reaches run`).toBe(false);
      for (const envName of taintedEnv) expect(shellReferencesEnv(run, envName), `${workflowName}: run executes env ${envName} tainted by reusable input`).toBe(false);
    }
  }
};

const readCheckedInWorkflows = () => new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));

describe('GitHub workflow untrusted shell boundary policy', () => {
  it('enforces boundary checks across every checked-in workflow and local reusable-workflow graph', () => {
    const workflows = readCheckedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);
    for (const workflow of workflows.values()) {
      expectNoQuotedEnvOrCmdBypass(workflow);
      expectNoCrossJobOutputBypass(workflow);
    }
    expectNoReusableWorkflowInputBypass(workflows);
  });

  it('scopes environment taint to the job that defines it', () => {
    const safe = [
      'jobs:',
      '  inspect:',
      '    env:',
      '      CMD: ${{ github.event.comment.body }}',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '  execute:',
      '    env:',
      '      CMD: echo-safe',
      '    steps:',
      '      - run: printf "$CMD"',
    ].join('\n');
    expect(() => expectNoQuotedEnvOrCmdBypass(safe)).not.toThrow();
  });

  it('inspects the complete producer step before classifying its output', () => {
    const filler = Array.from({ length: 20 }, (_, index) => `        # filler ${index}`);
    const unsafe = ['jobs:', '  producer:', '    outputs:', '      command: ${{ steps.capture.outputs.result }}', '    steps:', '      - id: capture', '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', ...filler, '        with:', '          script: return context.payload.comment.body', '  consumer:', '    needs: producer', '    steps:', '      - run: bash -c "${{ needs.producer.outputs.command }}"'].join('\n');
    expect(() => expectNoCrossJobOutputBypass(unsafe)).toThrow();
  });

  it('propagates taint through nested reusable workflows to a fixed point', () => {
    const workflows = new Map<string, string>([
      ['a.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/b.yml', '    with:', '      command: ${{ github.event.comment.body }}'].join('\n')],
      ['b.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/c.yml', '    with:', '      command: ${{ inputs.command }}'].join('\n')],
      ['c.yml', ['jobs:', '  run:', '    steps:', '      - run: bash -c "${{ inputs.command }}"'].join('\n')],
    ]);
    expect(() => expectNoReusableWorkflowInputBypass(workflows)).toThrow();
  });

  it('rejects quoted tainted env keys executed by cmd.exe percent expansion', () => {
    const unsafe = ['jobs:', '  execute:', '    env:', '      "CMD": ${{ github.event.comment.body }}', '    steps:', '      - shell: cmd', '        run: call %CMD%'].join('\n');
    expect(() => expectNoQuotedEnvOrCmdBypass(unsafe)).toThrow();
  });

  it('allows safe literal values across the same boundaries', () => {
    const safe = ['jobs:', '  execute:', '    env:', '      CMD: echo-safe', '    steps:', '      - shell: cmd', '        run: call %CMD%'].join('\n');
    expect(() => expectNoQuotedEnvOrCmdBypass(safe)).not.toThrow();
  });
});
