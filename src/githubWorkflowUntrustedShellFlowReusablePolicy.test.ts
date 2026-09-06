import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const isUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/.test(normalizeAccess(value));

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
    else if (char === '}' || char === ']' || char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
};

const parseFlowMap = (raw: string) => {
  const value = raw.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return new Map<string, string>();
  const result = new Map<string, string>();
  for (const entry of splitFlowEntries(value.slice(1, -1))) {
    const separator = entry.indexOf(':');
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim().replace(/^['"]|['"]$/g, '');
    const entryValue = entry.slice(separator + 1).trim();
    if (key) result.set(key, entryValue);
  }
  return result;
};

const expectNoFlowStyleReusableInputBypass = (workflows: Map<string, string>) => {
  for (const [callerName, caller] of workflows) {
    const lines = caller.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const uses = lines[index].match(/^\s*uses\s*:\s*\.\/\.github\/workflows\/([^\s#]+)\s*$/)?.[1];
      if (!uses) continue;

      const usesIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
      for (let child = index + 1; child < lines.length; child += 1) {
        const line = lines[child];
        const trimmed = line.trim();
        const indent = line.match(/^\s*/)?.[0].length ?? 0;
        if (trimmed && indent <= usesIndent) break;

        const flowWith = line.match(/^\s*with\s*:\s*(\{.*\})\s*$/)?.[1];
        if (!flowWith) continue;
        const callee = workflows.get(uses);
        if (!callee) continue;

        for (const [input, value] of parseFlowMap(flowWith)) {
          if (!isUntrusted(value)) continue;
          const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const reachesRun = new RegExp(`^\\s*(?:-\\s*)?run\\s*:\\s*.*inputs\\.${escaped}\\b`, 'm').test(callee);
          expect(reachesRun, `${callerName} passes untrusted flow-style input ${input} to shell in ${uses}`).toBe(false);
        }
      }
    }
  }
};

const readCheckedInWorkflows = () => new Map(
  readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => [name, readFileSync(join(workflowsDir, name), 'utf8')]),
);

describe('GitHub workflow flow-style reusable-input policy', () => {
  it('enforces flow-style reusable-workflow arguments across checked-in workflows', () => {
    expectNoFlowStyleReusableInputBypass(readCheckedInWorkflows());
  });

  it('rejects an untrusted flow-style reusable-workflow argument reaching run', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/callee.yml',
        '    with: { command: "${{ github.event.comment.body }}" }',
      ].join('\n')],
      ['callee.yml', [
        'on:',
        '  workflow_call:',
        '    inputs:',
        '      command:',
        '        type: string',
        'jobs:',
        '  execute:',
        '    steps:',
        '      - run: bash -c "${{ inputs.command }}"',
      ].join('\n')],
    ]);

    expect(() => expectNoFlowStyleReusableInputBypass(workflows)).toThrow(/flow-style input command/);
  });

  it('allows a constant flow-style reusable-workflow argument', () => {
    const workflows = new Map<string, string>([
      ['caller.yml', [
        'jobs:',
        '  call:',
        '    uses: ./.github/workflows/callee.yml',
        '    with: { command: "echo safe" }',
      ].join('\n')],
      ['callee.yml', 'jobs:\n  execute:\n    steps:\n      - run: bash -c "${{ inputs.command }}"'],
    ]);

    expect(() => expectNoFlowStyleReusableInputBypass(workflows)).not.toThrow();
  });
});
