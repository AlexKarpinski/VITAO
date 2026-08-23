import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && line[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const unquote = (value: string) => {
  const trimmed = value.trim().replace(/[,}]\s*$/, '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const decodeYamlKey = (rawKey: string) => {
  const key = rawKey.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try {
      return JSON.parse(key);
    } catch {
      return key.slice(1, -1);
    }
  }
  if (key.startsWith("'") && key.endsWith("'")) {
    return key.slice(1, -1).replace(/''/g, "'");
  }
  return key;
};

const extractActionRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let ignoredBlockIndent: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const withoutComment = stripYamlComment(rawLine);
    const trimmed = withoutComment.trim();

    if (ignoredBlockIndent !== null) {
      if (!trimmed || indent > ignoredBlockIndent) continue;
      ignoredBlockIndent = null;
    }
    if (!trimmed) continue;

    const canonical = withoutComment.match(
      /^\s*(?:-\s*)?((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+))\s*:\s*(.*)$/,
    );
    if (canonical && decodeYamlKey(canonical[1]) === 'uses') {
      const value = canonical[2].trim();
      if (/^[|>][+-]?\d*\s*$/.test(value)) {
        const folded: string[] = [];
        for (let child = index + 1; child < lines.length; child += 1) {
          const childRaw = lines[child];
          const childTrimmed = stripYamlComment(childRaw).trim();
          const childIndent = childRaw.match(/^\s*/)?.[0].length ?? 0;
          if (childTrimmed && childIndent <= indent) break;
          if (childTrimmed) folded.push(childTrimmed);
          index = child;
        }
        if (folded.length) refs.push(unquote(folded.join(' ')));
      } else if (value) {
        refs.push(unquote(value));
      } else {
        for (let child = index + 1; child < lines.length; child += 1) {
          const childRaw = lines[child];
          const childWithoutComment = stripYamlComment(childRaw);
          const childTrimmed = childWithoutComment.trim();
          const childIndent = childRaw.match(/^\s*/)?.[0].length ?? 0;
          if (!childTrimmed) continue;
          if (childIndent <= indent) break;
          refs.push(unquote(childTrimmed));
          index = child;
          break;
        }
      }
      continue;
    }

    if (/:\s*[|>][+-]?\d*\s*$/.test(withoutComment)) {
      ignoredBlockIndent = indent;
      continue;
    }
    if (/^\s*-?\s*["']?run["']?\s*:/.test(withoutComment)) continue;

    const flowEntryPattern = /(?:^|[{,])\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z0-9_-]+))\s*:\s*("[^"]+"|'[^']+'|[^,}\s]+)/g;
    for (const flowEntry of withoutComment.matchAll(flowEntryPattern)) {
      if (decodeYamlKey(flowEntry[1]) === 'uses') refs.push(unquote(flowEntry[2]));
    }
  }

  return refs;
};

const expectImmutableExternalActions = (workflow: string, source: string) => {
  for (const actionRef of extractActionRefs(workflow)) {
    if (actionRef.startsWith('./')) continue;
    expect(actionRef, `${source}: ${actionRef}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
  }
};

describe('GitHub workflow action pinning policy', () => {
  it('pins every external action in every workflow to an immutable full commit SHA', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectImmutableExternalActions(workflow, workflowFile);
    }
  });

  it('accounts for quoted, escaped, flow-style, block-scalar, and indented plain-scalar YAML uses keys', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const workflow = [
      `- { name: Checkout, uses: actions/checkout@${sha} }`,
      `steps: [{uses: actions/cache@${sha}}, {uses: actions/setup-node@${sha}}]`,
      `steps: [{"\\u0075ses": actions/upload-artifact@${sha}}]`,
      `- 'uses': 'actions/setup-node@${sha}'`,
      `- "uses": "actions/upload-artifact@${sha}"`,
      `- "\\u0075ses": actions/cache@${sha}`,
      'uses: >-',
      `  actions/cache@${sha}`,
      '- uses:',
      `    actions/download-artifact@${sha}`,
      '- uses: ./local-action',
    ].join('\n');

    expect(extractActionRefs(workflow)).toEqual([
      `actions/checkout@${sha}`,
      `actions/cache@${sha}`,
      `actions/setup-node@${sha}`,
      `actions/upload-artifact@${sha}`,
      `actions/setup-node@${sha}`,
      `actions/upload-artifact@${sha}`,
      `actions/cache@${sha}`,
      `actions/cache@${sha}`,
      `actions/download-artifact@${sha}`,
      './local-action',
    ]);
    expectImmutableExternalActions(workflow, 'synthetic-workflow.yml');
  });

  it('ignores uses-like text in comments, run scalars, block scalars, and ordinary values', () => {
    const workflow = [
      '# uses: actions/checkout@v4',
      'name: demo # uses: actions/setup-node@v4',
      'run: echo "uses: actions/checkout@v4"',
      'run: |',
      '  echo "uses: actions/setup-node@v4"',
      'env: |',
      '  uses: actions/upload-artifact@v4',
      'env:',
      '  NOTE: "uses: actions/cache@v4"',
    ].join('\n');

    expect(extractActionRefs(workflow)).toEqual([]);
    expectImmutableExternalActions(workflow, 'synthetic-workflow.yml');
  });

  it('rejects mutable tags in non-canonical YAML forms', () => {
    for (const workflow of [
      '- { name: Checkout, uses: actions/checkout@v4 }',
      'steps: [{uses: owner/safe@0123456789abcdef0123456789abcdef01234567}, {uses: owner/unsafe@v1}]',
      'steps: [{"\\u0075ses": actions/checkout@v4}]',
      "- 'uses': actions/setup-node@v4",
      '- "uses": "actions/upload-artifact@v4"',
      '- "\\u0075ses": actions/cache@v4',
      'uses: >-\n  actions/cache@v4',
      '- uses:\n    actions/download-artifact@v4',
    ]) {
      expect(() => expectImmutableExternalActions(workflow, 'synthetic-workflow.yml')).toThrow();
    }
  });
});
