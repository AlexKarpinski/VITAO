import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableSha = /^[^\s@]+@[0-9a-fA-F]{40}$/;
type Quote = '"' | "'" | null;

const stripNodeProperties = (value: string) => {
  let trimmed = value.trim();
  while (true) {
    const property = trimmed.match(/^(?:&[A-Za-z0-9_-]+|!<[^>]+>|![^\s]+)\s+([\s\S]+)$/);
    if (!property) return trimmed;
    trimmed = property[1].trim();
  }
};

const decodeScalar = (value: string) => {
  const trimmed = stripNodeProperties(value);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const isEscapedDoubleQuote = (value: string, index: number) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

const splitTopLevel = (value: string, separator: string) => {
  const parts: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let quote: Quote = null;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char !== quote) continue;
      if (quote === "'" && value[i + 1] === "'") {
        i += 1;
        continue;
      }
      if (quote === '"' && isEscapedDoubleQuote(value, i)) continue;
      quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === separator && braces === 0 && brackets === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

const splitPair = (entry: string) => {
  let braces = 0;
  let brackets = 0;
  let quote: Quote = null;

  for (let i = 0; i < entry.length; i += 1) {
    const char = entry[i];
    if (quote) {
      if (char !== quote) continue;
      if (quote === "'" && entry[i + 1] === "'") {
        i += 1;
        continue;
      }
      if (quote === '"' && isEscapedDoubleQuote(entry, i)) continue;
      quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === ':' && braces === 0 && brackets === 0) {
      return [entry.slice(0, i).trim(), entry.slice(i + 1).trim()] as const;
    }
  }

  return null;
};

const mappingBody = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  return trimmed.slice(1, -1);
};

const collectRootFlowJobRefs = (workflow: string) => {
  const document = workflow.trim().replace(/^---\s*/, '');
  const rootBody = mappingBody(document);
  if (rootBody === null) return [];

  const jobsEntry = splitTopLevel(rootBody, ',')
    .map(splitPair)
    .find((pair) => pair && decodeScalar(pair[0]) === 'jobs');
  if (!jobsEntry) return [];

  const jobsBody = mappingBody(jobsEntry[1]);
  if (jobsBody === null) return [];

  const refs: string[] = [];
  for (const jobEntry of splitTopLevel(jobsBody, ',')) {
    const jobPair = splitPair(jobEntry);
    if (!jobPair) continue;
    const jobBody = mappingBody(jobPair[1]);
    if (jobBody === null) continue;

    for (const fieldEntry of splitTopLevel(jobBody, ',')) {
      const fieldPair = splitPair(fieldEntry);
      if (!fieldPair || decodeScalar(fieldPair[0]) !== 'uses') continue;
      refs.push(decodeScalar(fieldPair[1]));
    }
  }

  return refs;
};

const assertRootFlowJobsPinned = (workflow: string) => {
  for (const ref of collectRootFlowJobRefs(workflow)) {
    if (ref.startsWith('./')) continue;
    expect(ref, `Expected immutable reusable-workflow pin, got ${ref}`).toMatch(immutableSha);
  }
};

describe('GitHub workflow root flow jobs pinning policy', () => {
  it('rejects mutable reusable workflows inside a root flow mapping', () => {
    expect(() =>
      assertRootFlowJobsPinned(
        '{ "name": "Review", "on": "push", "jobs": { "call": { "uses": "owner/repo/.github/workflows/build.yml@main" } } }',
      ),
    ).toThrow(/Expected immutable reusable-workflow pin/);
  });

  it('accepts immutable reusable workflows inside a root flow mapping', () => {
    expect(() =>
      assertRootFlowJobsPinned(
        '{ "name": "Review", "on": "push", "jobs": { "call": { "uses": "owner/repo/.github/workflows/build.yml@0123456789abcdef0123456789abcdef01234567" } } }',
      ),
    ).not.toThrow();
  });

  it('normalizes node properties on root flow jobs and uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(() =>
      assertRootFlowJobsPinned(
        `{ "name": "Review", !!str jobs: { "call": { &uses-key uses: &workflow-ref "owner/repo/.github/workflows/build.yml@${sha}" } } }`,
      ),
    ).not.toThrow();
    expect(() =>
      assertRootFlowJobsPinned(
        '{ "name": "Review", !!str jobs: { "call": { &uses-key uses: &workflow-ref "owner/repo/.github/workflows/build.yml@main" } } }',
      ),
    ).toThrow(/Expected immutable reusable-workflow pin/);
  });

  it('accepts local reusable workflows inside a root flow mapping', () => {
    expect(() =>
      assertRootFlowJobsPinned(
        '{ "name": "Review", "on": "push", "jobs": { "call": { "uses": "./.github/workflows/reusable.yml" } } }',
      ),
    ).not.toThrow();
  });

  it('ignores nested uses-like job data', () => {
    expect(() =>
      assertRootFlowJobsPinned(
        '{ "name": "Review", "on": "push", "jobs": { "build": { "runs-on": "ubuntu-latest", "env": { "uses": "actions/checkout@v4" }, "steps": [{ "run": "echo safe" }] } } }',
      ),
    ).not.toThrow();
  });

  it('enforces the policy across checked-in workflows', () => {
    for (const workflowFile of workflowFiles) {
      assertRootFlowJobsPinned(readFileSync(join(workflowsDir, workflowFile), 'utf8'));
    }
  });
});
