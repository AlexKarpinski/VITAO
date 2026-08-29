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
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
          continue;
        }
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
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
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.(?:body|path|diff_hunk)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body)|changes\.(?:title|body)\.from)/.test(normalizeAccess(value));

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
  const jobs: string[] = [];
  let jobsIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index]);
    const indent = getIndent(lines[index]);
    if (jobsIndent === null) {
      if (/^\s*["']?jobs["']?\s*:\s*$/.test(line)) jobsIndent = indent;
      continue;
    }
    if (line.trim() && indent <= jobsIndent) break;
    if (indent <= jobsIndent || !/^\s*(?:["'][^"']+["']|[A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/.test(line)) continue;
    const { block, end } = collectIndentedBlock(lines, index, indent);
    jobs.push(block);
    index = end;
  }
  return jobs;
};

type SecretEdge = { caller: string; callee: string; secrets: Map<string, string> };

const extractSecretEdges = (workflows: Map<string, string>) => {
  const edges: SecretEdge[] = [];
  for (const [caller, workflow] of workflows) {
    for (const job of extractJobs(workflow)) {
      const uses = job.match(/^\s*["']?uses["']?\s*:\s*(.+)$/m)?.[1];
      const target = uses ? unwrapScalar(uses).match(/^\.\/\.github\/workflows\/([^\s#]+)$/)?.[1] : undefined;
      if (!target) continue;

      const secrets = new Map<string, string>();
      const lines = job.split('\n');
      let secretsIndent: number | null = null;
      for (const rawLine of lines) {
        const line = stripYamlComment(rawLine);
        const indent = getIndent(rawLine);
        if (secretsIndent === null) {
          if (/^\s*["']?secrets["']?\s*:\s*$/.test(line)) secretsIndent = indent;
          continue;
        }
        if (line.trim() && indent <= secretsIndent) break;
        const match = line.match(/^\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+)$/);
        if (match) secrets.set(unwrapScalar(match[1]), unwrapScalar(match[2]));
      }
      edges.push({ caller, callee: target, secrets });
    }
  }
  return edges;
};

const runUsesSecret = (workflow: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`secrets(?:\\.${escaped}|\\[\\s*['"]${escaped}['"]\\s*\\])\\b`);
  return workflow.split('\n').some((rawLine) => {
    const line = stripYamlComment(rawLine);
    const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.+)$/)?.[1];
    return Boolean(run && direct.test(normalizeAccess(unwrapScalar(run))));
  });
};

const expectNoReusableSecretShellBypass = (workflows: Map<string, string>) => {
  for (const edge of extractSecretEdges(workflows)) {
    const callee = workflows.get(edge.callee);
    if (!callee) continue;
    for (const [name, value] of edge.secrets) {
      if (isUntrusted(value)) {
        expect(runUsesSecret(callee, name), `${edge.caller} passes untrusted secret ${name} into shell in ${edge.callee}`).toBe(false);
      }
    }
  }
};

const readCheckedInWorkflows = () => new Map(workflowFiles.map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]));

describe('GitHub reusable-workflow secret shell boundary policy', () => {
  it('checks every checked-in local reusable-workflow secret edge', () => {
    expect(() => expectNoReusableSecretShellBypass(readCheckedInWorkflows())).not.toThrow();
  });

  it('rejects attacker-controlled text mapped through a reusable-workflow secret into run', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/callee.yml', '    secrets:', '      command: ${{ github.event.comment.body }}'].join('\n')],
      ['callee.yml', ['jobs:', '  execute:', '    steps:', '      - run: bash -c "${{ secrets.command }}"'].join('\n')],
    ]);
    expect(() => expectNoReusableSecretShellBypass(workflows)).toThrow();
  });

  it('allows the same secret when the callee never crosses a shell boundary', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', ['jobs:', '  call:', '    uses: ./.github/workflows/callee.yml', '    secrets:', '      message: ${{ github.event.comment.body }}'].join('\n')],
      ['callee.yml', ['jobs:', '  inspect:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        env:', '          MESSAGE: ${{ secrets.message }}'].join('\n')],
    ]);
    expect(() => expectNoReusableSecretShellBypass(workflows)).not.toThrow();
  });
});
