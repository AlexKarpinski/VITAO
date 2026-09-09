import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

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

const normalizeAccess = (value: string) =>
  value
    .replace(/\?\./g, '.')
    .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body)/.test(
    normalizeAccess(value),
  );

const collectBlock = (lines: string[], start: number, indent: number) => {
  const block = [lines[start]];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() && getIndent(lines[index]) <= indent) break;
    block.push(lines[index]);
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
    const indent = getIndent(lines[index]);
    if (jobsIndent === null) {
      if (/^\s*jobs\s*:\s*$/.test(line)) jobsIndent = indent;
      continue;
    }
    if (line.trim() && indent <= jobsIndent) break;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
    if (!match || indent <= jobsIndent) continue;
    const { block, end } = collectBlock(lines, index, indent);
    jobs.set(match[1], block);
    index = end;
  }
  return jobs;
};

const extractStepBlocks = (job: string) => {
  const lines = job.split('\n');
  const blocks: string[] = [];
  let stepsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const indent = getIndent(lines[index]);
    if (stepsIndent === null) {
      if (/^\s*steps\s*:\s*$/.test(line)) stepsIndent = indent;
      continue;
    }
    if (line.trim() && indent <= stepsIndent) break;
    if (!/^\s*-\s+/.test(line) || indent <= stepsIndent) continue;
    const block = [lines[index]];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      if (next.trim() && getIndent(next) === indent && /^\s*-\s+/.test(next)) break;
      if (next.trim() && getIndent(next) < indent) break;
      block.push(next);
      index += 1;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

const taintedStepIds = (job: string) => {
  const ids = new Set<string>();
  for (const step of extractStepBlocks(job)) {
    const id = step.match(/^\s*(?:-\s*)?id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/m)?.[1];
    if (id && isUntrusted(step)) ids.add(id);
  }
  return ids;
};

const extractMapping = (scope: string, key: string) => {
  const lines = scope.split('\n');
  const entries = new Map<string, string>();
  let mappingIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const indent = getIndent(lines[index]);
    if (mappingIndent === null) {
      if (new RegExp('^\\s*' + key + '\\s*:\\s*$').test(line)) mappingIndent = indent;
      continue;
    }
    if (line.trim() && indent <= mappingIndent) break;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$/);
    if (match) entries.set(match[1], unwrapScalar(match[2]));
  }
  return entries;
};

const collectTaintedJobOutputs = (workflow: string) => {
  const jobs = extractJobs(workflow);
  const tainted = new Set<string>();
  const outputs = new Map<string, Map<string, string>>();

  for (const [jobName, job] of jobs) {
    const stepIds = taintedStepIds(job);
    const jobOutputs = extractMapping(job, 'outputs');
    outputs.set(jobName, jobOutputs);
    for (const [outputName, rawValue] of jobOutputs) {
      const value = normalizeAccess(rawValue);
      const fromTaintedStep = [...stepIds].some((stepId) => value.includes('steps.' + stepId + '.outputs.'));
      if (isUntrusted(value) || fromTaintedStep) tainted.add(jobName + '.' + outputName);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [jobName, jobOutputs] of outputs) {
      for (const [outputName, rawValue] of jobOutputs) {
        if (tainted.has(jobName + '.' + outputName)) continue;
        const value = normalizeAccess(rawValue);
        const relayed = [...tainted].some((source) => {
          const [producer, producerOutput] = source.split('.');
          return value.includes('needs.' + producer + '.outputs.' + producerOutput);
        });
        if (relayed) {
          tainted.add(jobName + '.' + outputName);
          changed = true;
        }
      }
    }
  }

  return tainted;
};

type Edge = { caller: string; callee: string; args: Map<string, string> };

const reusableEdges = (workflows: Map<string, string>) => {
  const edges: Edge[] = [];
  for (const [caller, workflow] of workflows) {
    for (const job of extractJobs(workflow).values()) {
      const uses = job.match(/^\s*uses\s*:\s*(.+)$/m)?.[1];
      if (!uses) continue;
      const callee = unwrapScalar(uses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1];
      if (!callee) continue;
      edges.push({ caller, callee, args: extractMapping(job, 'with') });
    }
  }
  return edges;
};

const runValues = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => stripYamlComment(line).match(/^\s*(?:-\s*)?run\s*:\s*(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(unwrapScalar)
    .map(normalizeAccess);

const expectNoJobOutputReusableBypass = (workflows: Map<string, string>) => {
  const outputTaint = new Map<string, Set<string>>();
  for (const [name, workflow] of workflows) outputTaint.set(name, collectTaintedJobOutputs(workflow));

  const taintedInputs = new Map<string, Set<string>>();
  for (const name of workflows.keys()) taintedInputs.set(name, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of reusableEdges(workflows)) {
      const callerOutputs = outputTaint.get(edge.caller) ?? new Set<string>();
      const callerInputs = taintedInputs.get(edge.caller) ?? new Set<string>();
      const calleeInputs = taintedInputs.get(edge.callee) ?? new Set<string>();
      for (const [argName, rawValue] of edge.args) {
        const value = normalizeAccess(rawValue);
        const fromOutput = [...callerOutputs].some((source) => {
          const [producer, output] = source.split('.');
          return value.includes('needs.' + producer + '.outputs.' + output);
        });
        const inherited = [...callerInputs].some((input) => value.includes('inputs.' + input));
        if ((fromOutput || inherited || isUntrusted(value)) && !calleeInputs.has(argName)) {
          calleeInputs.add(argName);
          changed = true;
        }
      }
      taintedInputs.set(edge.callee, calleeInputs);
    }
  }

  for (const [name, workflow] of workflows) {
    const inputs = taintedInputs.get(name) ?? new Set<string>();
    for (const run of runValues(workflow)) {
      for (const input of inputs) {
        expect(run.includes('inputs.' + input), `${name}: tainted job output reaches reusable run via ${input}`).toBe(false);
      }
    }
  }
};

const checkedInWorkflows = () =>
  new Map(
    readdirSync(workflowsDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()
      .map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]),
  );

describe('GitHub workflow job-output to reusable-workflow shell policy', () => {
  it('rejects a tainted job output passed into a reusable workflow run sink', () => {
    const workflows = new Map<string, string>([
      [
        'caller.yml',
        [
          'jobs:',
          '  producer:',
          '    outputs:',
          '      command: ${{ steps.capture.outputs.result }}',
          '    steps:',
          '      - id: capture',
          '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
          '        with:',
          '          script: return context.payload.comment.body',
          '  call:',
          '    needs: producer',
          '    uses: ./.github/workflows/callee.yml',
          '    with:',
          '      command: ${{ needs.producer.outputs.command }}',
        ].join('\n'),
      ],
      [
        'callee.yml',
        ['jobs:', '  execute:', '    steps:', '      - run: bash -c "${{ inputs.command }}"'].join('\n'),
      ],
    ]);
    expect(() => expectNoJobOutputReusableBypass(workflows)).toThrow();
  });

  it('allows a constant job output passed to a reusable workflow', () => {
    const workflows = new Map<string, string>([
      [
        'caller.yml',
        [
          'jobs:',
          '  producer:',
          '    outputs:',
          '      command: echo-safe',
          '    steps:',
          '      - run: echo safe',
          '  call:',
          '    needs: producer',
          '    uses: ./.github/workflows/callee.yml',
          '    with:',
          '      command: ${{ needs.producer.outputs.command }}',
        ].join('\n'),
      ],
      [
        'callee.yml',
        ['jobs:', '  execute:', '    steps:', '      - run: bash -c "${{ inputs.command }}"'].join('\n'),
      ],
    ]);
    expect(() => expectNoJobOutputReusableBypass(workflows)).not.toThrow();
  });

  it('enforces the boundary across checked-in workflows', () => {
    const workflows = checkedInWorkflows();
    expect(workflows.size).toBeGreaterThan(0);
    expectNoJobOutputReusableBypass(workflows);
  });
});
