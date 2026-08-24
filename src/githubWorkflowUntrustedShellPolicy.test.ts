import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';

const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeGitHubExpressionAccess = (value: string) =>
  value.replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const stripYamlInlineComment = (value: string) => {
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (singleQuoted) {
      if (char === "'" && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") singleQuoted = false;
      continue;
    }

    if (doubleQuoted) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') doubleQuoted = false;
      continue;
    }

    if (char === "'") {
      singleQuoted = true;
      continue;
    }
    if (char === '"') {
      doubleQuoted = true;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
};

const decodeYamlKey = (raw: string) => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const isBlockScalarHeader = (value: string) =>
  /^[|>](?:(?:[+-])?(?:[1-9])?|(?:[1-9])(?:[+-])?)$/.test(value);

const collectIndentedScalar = (lines: string[], startIndex: number, parentIndent: number) => {
  const values: string[] = [];
  let endIndex = startIndex;
  for (let child = startIndex + 1; child < lines.length; child += 1) {
    const childLine = lines[child];
    const childTrimmed = childLine.trim();
    const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
    if (childTrimmed && childIndent <= parentIndent) break;
    if (childTrimmed) values.push(childTrimmed);
    endIndex = child;
  }
  return { value: values.join('\n'), endIndex };
};

const collectPlainScalarContinuation = (lines: string[], startIndex: number, parentIndent: number) => {
  const values: string[] = [];
  let endIndex = startIndex;

  for (let child = startIndex + 1; child < lines.length; child += 1) {
    const childLine = lines[child];
    const childTrimmed = childLine.trim();
    const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
    if (!childTrimmed) break;
    if (childIndent < parentIndent + 2) break;
    if (childIndent === parentIndent + 2 && /^(?:["']?[A-Za-z_][A-Za-z0-9_-]*["']?)\s*:/.test(childTrimmed)) break;
    values.push(childTrimmed);
    endIndex = child;
  }

  return { value: values.join('\n'), endIndex };
};

const extractRunScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:-\s*)?((?:run)|(?:["']run["']))\s*:\s*(.*)$/);
    if (!match || decodeYamlKey(match[2]) !== 'run') continue;

    const indent = match[1].length;
    const value = stripYamlInlineComment(match[3]);
    if (value && !isBlockScalarHeader(value)) {
      const continuation = collectPlainScalarContinuation(lines, index, indent);
      scripts.push([value, continuation.value].filter(Boolean).join('\n'));
      index = continuation.endIndex;
      continue;
    }

    const block = collectIndentedScalar(lines, index, indent);
    scripts.push(block.value);
    index = block.endIndex;
  }

  return scripts;
};

const untrustedTextExpressions = [
  'github.event.issue.title',
  'github.event.issue.body',
  'github.event.comment.body',
  'github.event.pull_request.title',
  'github.event.pull_request.body',
  'github.event.review.body',
  'github.event.review_comment.body',
  'context.payload.issue.title',
  'context.payload.issue.body',
  'context.payload.comment.body',
  'context.payload.pull_request.title',
  'context.payload.pull_request.body',
  'context.payload.review.body',
  'context.payload.review_comment.body',
];

const untrustedParentExpressions = [
  'github.event.issue',
  'github.event.comment',
  'github.event.pull_request',
  'github.event.review',
  'github.event.review_comment',
];

const containsUntrustedExpression = (value: string) => {
  const normalized = normalizeGitHubExpressionAccess(value);
  if (untrustedTextExpressions.some((expression) => normalized.includes(expression))) return true;

  return untrustedParentExpressions.some((expression) => {
    const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:toJSON|toJson)\\s*\\(\\s*${escaped}\\s*\\)`).test(normalized);
  });
};

const extractUntrustedEnvVars = (workflow: string) => {
  const vars = new Set<string>();
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const value = stripYamlInlineComment(match[3]);
    if (value && !isBlockScalarHeader(value)) {
      if (containsUntrustedExpression(value)) vars.add(match[2]);
      continue;
    }

    if (isBlockScalarHeader(value)) {
      const block = collectIndentedScalar(lines, index, indent);
      if (containsUntrustedExpression(block.value)) vars.add(match[2]);
      index = block.endIndex;
    }
  }

  return vars;
};

const extractUntrustedStepIds = (workflow: string) => {
  const ids = new Set<string>();
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)-\s+id\s*:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/);
    if (!match) continue;

    const stepIndent = match[1].length;
    const stepLines = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childTrimmed = childLine.trim();
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childTrimmed && childIndent <= stepIndent && /^\s*-\s+/.test(childLine)) break;
      stepLines.push(childLine);
    }

    if (containsUntrustedExpression(stepLines.join('\n'))) ids.add(match[2]);
  }

  return ids;
};

const scriptReferencesVariable = (script: string, name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = normalizeGitHubExpressionAccess(script);
  return new RegExp(
    `(?:\\$${escaped}\\b|\\$\\{${escaped}(?::[-+?=][^}]*)?\\}|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`,
    'i',
  ).test(normalized);
};

const scriptReferencesStepOutput = (script: string, stepId: string) => {
  const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normalized = normalizeGitHubExpressionAccess(script);
  return new RegExp(`\\$\\{\\{\\s*steps\\.${escaped}\\.outputs(?:\\.[A-Za-z_][A-Za-z0-9_-]*|\\[['"][^'"]+['"]\\])\\s*\\}\\}`, 'i').test(normalized);
};

const expectNoUntrustedTextInShell = (workflow: string, source: string) => {
  const untrustedEnvVars = extractUntrustedEnvVars(workflow);
  const untrustedStepIds = extractUntrustedStepIds(workflow);

  for (const script of extractRunScripts(workflow)) {
    expect(containsUntrustedExpression(script), `${source}: run step directly references untrusted event text`).toBe(false);

    for (const envVar of untrustedEnvVars) {
      expect(
        scriptReferencesVariable(script, envVar),
        `${source}: run step executes untrusted event text through env ${envVar}`,
      ).toBe(false);
    }

    for (const stepId of untrustedStepIds) {
      expect(
        scriptReferencesStepOutput(script, stepId),
        `${source}: run step executes untrusted event text through outputs of step ${stepId}`,
      ).toBe(false);
    }
  }
};

describe('GitHub workflow untrusted shell policy', () => {
  it('never interpolates issue, PR, comment, or review text into shell run steps', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, workflowFile), 'utf8');
      expectNoUntrustedTextInShell(workflow, workflowFile);
    }
  });

  it('checks inline and block run steps while allowing non-shell GitHub Script usage', () => {
    const safe = [
      'steps:',
      '  - run: npm test -- --run',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      '        const body = context.payload.comment?.body;',
    ].join('\n');

    expectNoUntrustedTextInShell(safe, 'safe.yml');
    expect(extractRunScripts(safe)).toEqual(['npm test -- --run']);
  });

  it('rejects direct dot and bracket access to untrusted event text', () => {
    const unsafeWorkflows = [
      'steps:\n  - run: echo "${{ github.event.comment.body }}"',
      'steps:\n  - run: echo "${{ github.event.comment[\'body\'] }}"',
      'steps:\n  - run: echo "${{ github[\'event\'][\'issue\'][\'body\'] }}"',
    ];

    for (const workflow of unsafeWorkflows) {
      expect(() => expectNoUntrustedTextInShell(workflow, 'unsafe.yml')).toThrow();
    }
  });

  it('rejects serialized parent event contexts', () => {
    const unsafeWorkflows = [
      'steps:\n  - run: echo "${{ toJSON(github.event.issue) }}"',
      'steps:\n  - run: echo "${{ toJSON(github.event.comment) }}"',
      'steps:\n  - run: echo "${{ toJSON(github.event.pull_request) }}"',
    ];

    for (const workflow of unsafeWorkflows) {
      expect(() => expectNoUntrustedTextInShell(workflow, 'serialized-parent.yml')).toThrow();
    }
  });

  it('rejects untrusted text routed through environment variables into shell commands', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'env-unsafe.yml')).toThrow();
  });

  it('rejects GitHub env-context interpolation of tainted variables', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "${{ env.CMD }}"',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'github-env-unsafe.yml')).toThrow();
  });

  it('rejects block-scalar environment values routed into shell commands', () => {
    const unsafe = [
      'env:',
      '  CMD: >-',
      '    ${{ github.event.comment.body }}',
      'steps:',
      '  - run: bash -c "$CMD"',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'block-env-unsafe.yml')).toThrow();
  });

  it('recognizes PowerShell environment-variable access', () => {
    const unsafe = [
      'env:',
      '  CMD: ${{ github.event.issue.body }}',
      'steps:',
      '  - shell: pwsh',
      '    run: Invoke-Expression $env:CMD',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'pwsh-env-unsafe.yml')).toThrow();
  });

  it('parses quoted and commented YAML run keys and block-scalar headers', () => {
    const unsafe = [
      'steps:',
      '  - "run": | # execute validation',
      '      printf "%s" "${{ github.event.issue.body }}"',
    ].join('\n');

    expect(extractRunScripts(unsafe)).toEqual(['printf "%s" "${{ github.event.issue.body }}"']);
    expect(() => expectNoUntrustedTextInShell(unsafe, 'quoted-run.yml')).toThrow();
  });

  it('accepts chomping-only YAML block scalar headers', () => {
    const unsafe = [
      'steps:',
      '  - run: >-',
      '      printf "%s" "${{ github.event.issue.body }}"',
    ].join('\n');

    expect(extractRunScripts(unsafe)).toEqual(['printf "%s" "${{ github.event.issue.body }}"']);
    expect(() => expectNoUntrustedTextInShell(unsafe, 'chomping-run.yml')).toThrow();
  });

  it('preserves hashes inside quoted YAML run scalars', () => {
    const unsafe = 'steps:\n  - run: \'echo " # ${{ github.event.comment.body }}"\'';

    expect(extractRunScripts(unsafe)).toEqual(['\'echo " # ${{ github.event.comment.body }}"\'']);
    expect(() => expectNoUntrustedTextInShell(unsafe, 'quoted-hash-run.yml')).toThrow();
  });

  it('rejects untrusted text routed through action step outputs', () => {
    const unsafe = [
      'steps:',
      '  - id: capture',
      '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      result-encoding: string',
      '      script: return context.payload.comment.body;',
      '  - run: bash -c "${{ steps.capture.outputs.result }}"',
    ].join('\n');

    expect(() => expectNoUntrustedTextInShell(unsafe, 'step-output-unsafe.yml')).toThrow();
  });

  it('parses multiline plain run scalars', () => {
    const unsafe = [
      'steps:',
      '  - run: echo safe',
      '      ${{ github.event.comment.body }}',
    ].join('\n');

    expect(extractRunScripts(unsafe)).toEqual(['echo safe\n${{ github.event.comment.body }}']);
    expect(() => expectNoUntrustedTextInShell(unsafe, 'multiline-plain-run.yml')).toThrow();
  });
});