import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedExpression = /\$\{\{[\s\S]*?github\s*(?:\.\s*event|\[\s*['"]event['"]\s*\])[\s\S]*?(?:issue|comment|pull_request|discussion|workflow_run)[\s\S]*?(?:body|title|diff_hunk|path|head_ref|head_branch|display_title)[\s\S]*?\}\}/i;
const blockScalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*(?:#.*)?$/;

const collectExplicitRunValues = (workflow: string) => {
  const lines = workflow.split('\n');
  const values: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const keyLine = lines[index];
    const keyMatch = keyLine.match(/^(\s*)-?\s*\?\s*(?:['"]?run['"]?)\s*(?:#.*)?$/);
    if (!keyMatch) continue;

    const keyIndent = keyMatch[1].length;
    let valueLine = index + 1;
    while (valueLine < lines.length && !lines[valueLine].trim()) valueLine += 1;
    if (valueLine >= lines.length) continue;

    const valueMatch = lines[valueLine].match(/^(\s*):\s*(.*)$/);
    if (!valueMatch || valueMatch[1].length < keyIndent) continue;
    const rawValue = valueMatch[2].trim();

    if (!blockScalarHeader.test(rawValue)) {
      if (rawValue) values.push(rawValue);
      index = valueLine;
      continue;
    }

    const valueIndent = valueMatch[1].length;
    const body: string[] = [];
    let child = valueLine + 1;
    for (; child < lines.length; child += 1) {
      const raw = lines[child];
      if (!raw.trim()) {
        body.push('');
        continue;
      }
      const indent = raw.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= valueIndent) break;
      body.push(raw.trim());
    }
    values.push(body.join('\n'));
    index = child - 1;
  }

  return values;
};

const assertExplicitRunsAreSafe = (workflow: string) => {
  for (const value of collectExplicitRunValues(workflow)) {
    expect(value, 'explicit run keys must not interpolate untrusted GitHub text').not.toMatch(untrustedExpression);
  }
};

describe('GitHub workflow explicit block run policy', () => {
  it('rejects untrusted text in an explicit block-scalar run key', () => {
    const workflow = `
on: issue_comment
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - ? run
        : |
          bash -c "\${{ github.event.comment.body }}"
`;
    expect(() => assertExplicitRunsAreSafe(workflow)).toThrow();
  });

  it('accepts a constant explicit block-scalar run key', () => {
    const workflow = `
on: workflow_dispatch
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - ? run
        : >-
          printf '%s\\n' safe
`;
    expect(() => assertExplicitRunsAreSafe(workflow)).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const file of workflowFiles) {
      assertExplicitRunsAreSafe(readFileSync(join(workflowsDir, file), 'utf8'));
    }
  });
});
