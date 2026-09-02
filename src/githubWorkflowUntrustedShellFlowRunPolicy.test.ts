import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedExpressions = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
  'github.event.discussion.title',
  'github.event.discussion.body',
];

const normalizeExpressionAccess = (value: string) =>
  value
    .replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1')
    .replace(/\?\./g, '.');

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && (quote === "'" || line[index - 1] !== '\\')) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1] ?? ''))) return line.slice(0, index);
  }
  return line;
};

const decodeRunValue = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
};

const collectRunMappings = (source: string, scripts: string[]) => {
  const pattern = /(?:^|[{,])\s*(?:"run"|'run'|run)\s*:\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,}]+)(?=\s*[,}])/g;
  for (const match of source.matchAll(pattern)) scripts.push(decodeRunValue(match[1]));
};

const extractFlowRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  for (const rawLine of workflow.split('\n')) {
    const line = stripYamlComment(rawLine);
    if (/^\s*-\s*\{/.test(line)) collectRunMappings(line, scripts);

    const stepsMatch = line.match(/(?:^|[{,])\s*(?:"steps"|'steps'|steps)\s*:\s*\[/);
    if (stepsMatch?.index !== undefined) {
      const opening = line.indexOf('[', stepsMatch.index);
      if (opening >= 0) collectRunMappings(line.slice(opening), scripts);
    }
  }
  return scripts;
};

const expectNoUntrustedFlowRun = (workflow: string, source: string) => {
  for (const script of extractFlowRunScripts(workflow)) {
    const normalized = normalizeExpressionAccess(script);
    for (const expression of untrustedExpressions) {
      expect(normalized, `${source}: ${script}`).not.toContain(expression);
    }
  }
};

describe('GitHub workflow flow-style shell trust policy', () => {
  it('rejects untrusted GitHub text in checked-in flow-style run steps', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedFlowRun(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects mutable event text in a flow-style run mapping', () => {
    expect(() =>
      expectNoUntrustedFlowRun(
        `steps:\n  - { run: 'bash -c "\${{ github.event.comment.body }}"' }`,
        'unsafe.yml',
      ),
    ).toThrow();
  });

  it('rejects discussion titles in a flow-style run mapping', () => {
    expect(() =>
      expectNoUntrustedFlowRun(
        `steps:\n  - { run: 'bash -c "\${{ github.event.discussion.title }}"' }`,
        'discussion-title.yml',
      ),
    ).toThrow();
  });

  it('rejects untrusted text in an inline steps flow sequence', () => {
    expect(() =>
      expectNoUntrustedFlowRun(
        `jobs: { build: { steps: [{ run: 'bash -c "\${{ github.event.issue.body }}"' }] } }`,
        'inline-steps.yml',
      ),
    ).toThrow();
  });

  it('does not treat unrelated flow mappings as executable steps', () => {
    expect(() =>
      expectNoUntrustedFlowRun(
        `strategy: { matrix: { include: [{ run: '\${{ github.event.issue.body }}' }] } }\nsteps: [{ run: 'echo safe' }]`,
        'matrix-data.yml',
      ),
    ).not.toThrow();
  });

  it('accepts a safe flow-style run mapping', () => {
    expect(() =>
      expectNoUntrustedFlowRun(`steps:\n  - { run: 'echo safe' }`, 'safe.yml'),
    ).not.toThrow();
  });
});
