import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentation = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const splitSteps = (workflow: string) => {
  const lines = workflow.split('\n');
  const steps: string[][] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+\S/);
    if (!start) continue;

    const indent = start[1].length;
    const step = [lines[index]];
    let child = index + 1;
    for (; child < lines.length; child += 1) {
      const line = lines[child];
      const trimmed = line.trim();
      if (trimmed && indentation(line) <= indent && /^\s*-\s+\S/.test(line)) break;
      if (trimmed && indentation(line) < indent) break;
      step.push(line);
    }

    steps.push(step);
    index = child - 1;
  }

  return steps;
};

const fieldValue = (step: string[], field: string) => {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (let index = 0; index < step.length; index += 1) {
    const match = step[index].match(new RegExp(`^\\s*(?:-\\s*)?${escaped}\\s*:\\s*(.*)$`));
    if (!match) continue;

    const value = match[1].trim();
    if (value && !/^[|>][+-]?\d*$/.test(value)) return value;

    const indent = indentation(step[index]);
    const block: string[] = [];
    for (let child = index + 1; child < step.length; child += 1) {
      const line = step[child];
      const trimmed = line.trim();
      if (trimmed && indentation(line) <= indent) break;
      if (trimmed) block.push(trimmed);
    }
    return block.join('\n');
  }
  return '';
};

const stepId = (step: string[]) => {
  for (const line of step) {
    const match = line.match(/^\s*(?:-\s*)?id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:#.*)?$/);
    if (match) return match[1];
  }
  return null;
};

const isGitHubScriptStep = (step: string[]) =>
  step.some((line) => /^\s*(?:-\s*)?uses\s*:\s*actions\/github-script@/i.test(line));

const returnsUntrustedText = (step: string[]) => {
  const script = fieldValue(step, 'script');
  return /\breturn\s+(?:github\.event\.(?:issue|comment|pull_request|review|review_comment)|context\.payload\.(?:issue|comment|pull_request|review|review_comment))\b/.test(
    script,
  );
};

const commandExecutesStepOutput = (run: string, id: string) => {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const output = `\\$\\{\\{\\s*steps\\.${escaped}\\.outputs(?:\\.result|\\[['\"]result['\"]\\])\\s*\\}\\}`;
  const reference = new RegExp(output, 'i');
  if (!reference.test(run)) return false;

  return (
    new RegExp(`(?:^|[;&|]\\s*)${output}(?:\\s|$)`, 'i').test(run) ||
    new RegExp(`\\b(?:ba|z|da|k)?sh\\s+-c\\s+["']?[^"']*${output}`, 'i').test(run) ||
    new RegExp(`\\beval\\s+["']?[^"']*${output}`, 'i').test(run) ||
    new RegExp(`\\b(?:Invoke-Expression|iex|call)\\b[^\\n]*${output}`, 'i').test(run)
  );
};

const violations = (workflow: string) => {
  const steps = splitSteps(workflow);
  const taintedIds = new Set(
    steps
      .filter(isGitHubScriptStep)
      .filter(returnsUntrustedText)
      .map(stepId)
      .filter((id): id is string => Boolean(id)),
  );

  const found: string[] = [];
  for (const step of steps) {
    const run = fieldValue(step, 'run');
    if (!run) continue;
    for (const id of taintedIds) {
      if (commandExecutesStepOutput(run, id)) found.push(id);
    }
  }
  return found;
};

describe('GitHub Script output key-order shell policy', () => {
  it('rejects tainted GitHub Script outputs when id follows uses', () => {
    const workflow = `jobs:\n  guard:\n    steps:\n      - uses: actions/github-script@v7\n        id: capture\n        with:\n          script: |\n            return context.payload.comment.body\n      - run: bash -c "\${{ steps.capture.outputs.result }}"`;

    expect(violations(workflow)).toEqual(['capture']);
  });

  it('allows the same tainted output when it is only printed as data', () => {
    const workflow = `jobs:\n  guard:\n    steps:\n      - uses: actions/github-script@v7\n        id: capture\n        with:\n          script: |\n            return context.payload.comment.body\n      - run: printf '%s\\n' "\${{ steps.capture.outputs.result }}"`;

    expect(violations(workflow)).toEqual([]);
  });

  it('guards checked-in workflows regardless of step key order', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expect(violations(workflow), `${workflowFile}: tainted GitHub Script output reaches a command sink`).toEqual([]);
    }
  });
});
