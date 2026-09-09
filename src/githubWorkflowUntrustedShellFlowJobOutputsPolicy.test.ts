import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrusted = (value: string) =>
  /github\.event\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(value);

const splitFlowEntries = (value: string) => {
  const entries: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = 0;

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
    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
};

const parseFlowMapping = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return new Map<string, string>();
  const body = trimmed.slice(1, -1);
  const mapping = new Map<string, string>();

  for (const entry of splitFlowEntries(body)) {
    let quote: '"' | "'" | null = null;
    let depth = 0;
    let separator = -1;
    for (let index = 0; index < entry.length; index += 1) {
      const char = entry[index];
      if (quote) {
        if (char === quote && (quote === "'" || entry[index - 1] !== '\\')) quote = null;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{' || char === '[' || char === '(') depth += 1;
      if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
      if (char === ':' && depth === 0) {
        separator = index;
        break;
      }
    }
    if (separator < 0) continue;
    const key = entry.slice(0, separator).trim().replace(/^['"]|['"]$/g, '');
    const value = entry.slice(separator + 1).trim();
    if (key) mapping.set(key, value);
  }

  return mapping;
};

const getIndent = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const extractJobs = (workflow: string) => {
  const lines = workflow.split('\n');
  const jobs = new Map<string, string>();
  const jobsLine = lines.findIndex((line) => /^\s*jobs\s*:\s*$/.test(line));
  if (jobsLine < 0) return jobs;
  const jobsIndent = getIndent(lines[jobsLine]);

  for (let index = jobsLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && getIndent(line) <= jobsIndent) break;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/);
    if (!match || getIndent(line) <= jobsIndent) continue;
    const indent = getIndent(line);
    const block = [line];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      if (childLine.trim() && getIndent(childLine) <= indent) break;
      block.push(childLine);
      index = child;
    }
    jobs.set(match[1], block.join('\n'));
  }
  return jobs;
};

const taintedStepIds = (job: string) => {
  const ids = new Set<string>();
  const lines = job.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const id = lines[index].match(/^\s*-?\s*id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/)?.[1];
    if (!id) continue;
    const indent = getIndent(lines[index]);
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      if (lines[child].trim() && getIndent(lines[child]) <= indent && /^\s*-/.test(lines[child])) break;
      block.push(lines[child]);
      index = child;
    }
    if (untrusted(block.join('\n'))) ids.add(id);
  }
  return ids;
};

const expectNoFlowStyleJobOutputBypass = (workflow: string) => {
  const jobs = extractJobs(workflow);
  const tainted = new Set<string>();

  for (const [jobName, job] of jobs) {
    const stepIds = taintedStepIds(job);
    for (const line of job.split('\n')) {
      const flow = line.match(/^\s*outputs\s*:\s*(\{.*\})\s*$/)?.[1];
      if (!flow) continue;
      for (const [outputName, value] of parseFlowMapping(flow)) {
        for (const stepId of stepIds) {
          const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`steps\\.${escaped}\\.outputs(?:\\.|\\[)`).test(value)) {
            tainted.add(`${jobName}.${outputName}`);
          }
        }
      }
    }
  }

  for (const [jobName, job] of jobs) {
    for (const line of job.split('\n')) {
      const run = line.match(/^\s*-?\s*run\s*:\s*(.+)$/)?.[1];
      if (!run) continue;
      for (const key of tainted) {
        const [producer, output] = key.split('.');
        const pattern = new RegExp(`needs\\.${producer}\\.outputs\\.${output}\\b`);
        expect(pattern.test(run), `${jobName}: flow-style tainted job output reaches run`).toBe(false);
      }
    }
  }
};

describe('GitHub workflow flow-style job output policy', () => {
  it('enforces the policy across every checked-in workflow', () => {
    for (const name of workflowFiles) {
      expectNoFlowStyleJobOutputBypass(readFileSync(join(workflowsDir, name), 'utf8'));
    }
  });

  it('rejects a tainted step output exported through a flow-style job output', () => {
    const unsafe = [
      'jobs:',
      '  producer:',
      '    outputs: { command: "${{ steps.capture.outputs.result }}" }',
      '    steps:',
      '      - id: capture',
      '        uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: return github.event.comment.body',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      '      - run: bash -c "${{ needs.producer.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoFlowStyleJobOutputBypass(unsafe)).toThrow();
  });

  it('allows the same flow-style boundary when the producer output is constant', () => {
    const safe = [
      'jobs:',
      '  producer:',
      '    outputs: { command: "${{ steps.capture.outputs.result }}" }',
      '    steps:',
      '      - id: capture',
      '        run: echo "result=echo-safe" >> "$GITHUB_OUTPUT"',
      '  consumer:',
      '    needs: producer',
      '    steps:',
      '      - run: bash -c "${{ needs.producer.outputs.command }}"',
    ].join('\n');
    expect(() => expectNoFlowStyleJobOutputBypass(safe)).not.toThrow();
  });
});
