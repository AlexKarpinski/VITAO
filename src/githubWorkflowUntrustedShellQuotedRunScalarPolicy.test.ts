import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const yamlDoubleQuotedToJson = (value: string) =>
  value
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => `\\u00${hex}`)
    .replace(/\\U([0-9a-fA-F]{8})/g, (match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return match;
      if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
      const adjusted = codePoint - 0x10000;
      const high = 0xd800 + (adjusted >> 10);
      const low = 0xdc00 + (adjusted & 0x3ff);
      return `\\u${high.toString(16)}\\u${low.toString(16)}`;
    });

const decodeQuotedYamlScalar = (raw: string) => {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(yamlDoubleQuotedToJson(value)) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};

const runScalars = (workflow: string) =>
  workflow
    .split('\n')
    .map((line) => line.match(/^\s*(?:-\s*)?(?:run|"run"|'run')\s*:\s*(.+?)\s*$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(decodeQuotedYamlScalar);

const directEventExpression = /\$\{\{\s*github\.event(?:\.|\[)/;

const expectNoDirectEventInRun = (workflow: string, source: string) => {
  for (const run of runScalars(workflow)) {
    expect(run, `${source}: ${run}`).not.toMatch(directEventExpression);
  }
};

describe('GitHub workflow quoted run scalar policy', () => {
  it('decodes quoted YAML run scalars before checking the shell boundary', () => {
    expect(() =>
      expectNoDirectEventInRun(
        'steps:\n  - run: "echo ${{ github\\u002eevent.comment.body }}"',
        'quoted-run.yml',
      ),
    ).toThrow();

    expect(() =>
      expectNoDirectEventInRun(
        'steps:\n  - run: "echo ${{ github\\x2eevent.issue.title }}"',
        'quoted-run-hex.yml',
      ),
    ).toThrow();

    expectNoDirectEventInRun('steps:\n  - run: "echo safe"', 'safe.yml');
  });

  it('enforces the decoded run-scalar boundary across every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoDirectEventInRun(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
