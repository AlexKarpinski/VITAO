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
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/
    .test(normalizeAccess(value));

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

const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const collectScalar = (lines: string[], start: number, parentIndent: number) => {
  const body: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentOf(line) <= parentIndent) break;
    body.push(line.trim());
    end = index;
  }
  return { value: body.join('\n'), end };
};

const normalizeNeeds = (value: string) => normalizeAccess(value);

const expectNoBracketedNeedsRun = (workflow: string) => {
  const normalized = normalizeNeeds(workflow);
  const taintedOutputs = new Set<string>();
  for (const match of normalized.matchAll(/outputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z_][A-Za-z0-9_-]*\s*\}\}/g)) {
    const stepId = match[2];
    const stepPattern = new RegExp(`(?:^|\\n)\\s*-?[\\s\\S]{0,800}?id:\\s*["']?${stepId}["']?[\\s\\S]{0,1200}?(?:github\\.event|context\\.payload)`, 'm');
    if (stepPattern.test(normalized)) taintedOutputs.add(match[1]);
  }
  for (const output of taintedOutputs) {
    const escaped = output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const run = new RegExp(`run:[^\\n]*(?:needs\\.[A-Za-z_][A-Za-z0-9_-]*\\.outputs\\.${escaped})`);
    expect(run.test(normalized), `tainted job output ${output} reaches run`).toBe(false);
  }
};

const collectReusableArgs = (workflow: string) => {
  const args: string[] = [];
  const lines = workflow.split('\n');
  let inLocalReusableJob = false;
  let withIndent: number | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const indent = indentOf(raw);
    if (/^\s*uses:\s*["']?\.\/\.github\/workflows\//.test(line)) {
      inLocalReusableJob = true;
      withIndent = null;
      continue;
    }
    if (!inLocalReusableJob) continue;
    if (withIndent === null) {
      if (/^\s*with:\s*$/.test(line)) withIndent = indent;
      continue;
    }
    if (line.trim() && indent <= withIndent) {
      inLocalReusableJob = false;
      withIndent = null;
      continue;
    }
    const entry = line.match(/^\s*["']?[A-Za-z_][A-Za-z0-9_-]*["']?\s*:\s*(.*)$/);
    if (!entry) continue;
    const value = entry[1].trim();
    if (scalarHeader.test(value)) {
      const scalar = collectScalar(lines, index, indent);
      args.push(scalar.value);
      index = scalar.end;
    } else {
      args.push(value);
    }
  }
  return args;
};

const expectNoUntrustedReusableArgs = (workflow: string) => {
  for (const value of collectReusableArgs(workflow)) {
    expect(untrusted(value), `untrusted text reaches reusable-workflow input: ${value}`).toBe(false);
  }
};

describe('GitHub workflow boundary edge policy', () => {
  it('enforces bracketed needs and reusable block-scalar boundaries across checked-in workflows', () => {
    for (const name of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, name), 'utf8');
      expectNoBracketedNeedsRun(workflow);
      expectNoUntrustedReusableArgs(workflow);
    }
  });

  it('rejects bracketed needs access for a tainted producer output', () => {
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
      '    steps:',
      `      - run: bash -c "\${{ needs['producer'].outputs.command }}"`,
    ].join('\n');
    expect(() => expectNoBracketedNeedsRun(unsafe)).toThrow();
  });

  it('rejects untrusted block-scalar arguments passed to a local reusable workflow', () => {
    const unsafe = [
      'jobs:',
      '  call:',
      '    uses: ./.github/workflows/reusable.yml',
      '    with:',
      '      command: >-',
      '        ${{ github.event.comment.body }}',
    ].join('\n');
    expect(() => expectNoUntrustedReusableArgs(unsafe)).toThrow();
  });
});
