import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === "'") {
      if (char === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index);
  }
  return line;
};

const normalizeGithubAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1')
  .replace(/\s*\.\s*/g, '.');

const unwrapYamlQuotes = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
};

const scriptKey = String.raw`(?:script|"script"|'script')`;
const untrustedGithubSourcePath = /\b(?:github\.head_ref|github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body)))\b/;

const isUntrustedGithubScriptSource = (value: string) => {
  const source = normalizeGithubAccess(unwrapYamlQuotes(value));
  for (const expression of source.matchAll(/\$\{\{([\s\S]*?)\}\}/g)) {
    if (untrustedGithubSourcePath.test(normalizeGithubAccess(expression[1]))) return true;
  }
  return false;
};

const scriptSourceFromLine = (line: string) => {
  const structural = stripYamlComment(line);
  const direct = structural.match(new RegExp(`^\\s*${scriptKey}\\s*:\\s*(.+?)\\s*$`));
  if (direct) return direct[1];

  const flowWith = structural.match(/^\s*with\s*:\s*\{([\s\S]*)\}\s*$/);
  if (!flowWith) return null;
  const script = flowWith[1].match(
    new RegExp(`(?:^|,)\\s*${scriptKey}\\s*:\\s*((?:"[^"\\n]*"|'[^'\\n]*'|\\$\\{\\{[\\s\\S]*?\\}\\}))(?=\\s*,|\\s*$)`),
  );
  return script?.[1] ?? null;
};

const explicitScriptKey = (line: string) => {
  const match = stripYamlComment(line).match(new RegExp(`^(\\s*)\\?\\s*${scriptKey}\\s*$`));
  return match ? match[1].length : null;
};

const explicitScriptValue = (line: string, keyIndent: number) => {
  const structural = stripYamlComment(line);
  if (indentOf(structural) !== keyIndent) return null;
  return structural.match(/^\s*:\s*(.+?)\s*$/)?.[1] ?? null;
};

const blockScalarHeader = (value: string) => /^[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*$/.test(value);

const flowStepScriptSource = (line: string) => {
  const structural = stripYamlComment(line);
  if (!/^\s*-\s*\{/.test(structural)) return null;
  if (!/(?:^|[,\s{])(?:uses|"uses"|'uses')\s*:\s*['"]?actions\/github-script@[^\s,'"}]+/i.test(structural)) return null;
  const withMapping = structural.match(/(?:^|[,\s{])with\s*:\s*\{([\s\S]*?)\}\s*\}\s*$/);
  if (!withMapping) return null;
  const script = withMapping[1].match(
    new RegExp(`(?:^|,)\\s*${scriptKey}\\s*:\\s*((?:"[^"\\n]*"|'[^'\\n]*'|\\$\\{\\{[\\s\\S]*?\\}\\}))(?=\\s*,|\\s*$)`),
  );
  return script?.[1] ?? null;
};

const collectGithubScriptSources = (workflow: string) => {
  const sources: string[] = [];
  const lines = workflow.split('\n');

  for (const line of lines) {
    const flowSource = flowStepScriptSource(line);
    if (flowSource !== null) sources.push(flowSource);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const uses = stripYamlComment(lines[index]).match(
      /^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/i,
    );
    if (!uses) continue;
    const stepIndent = uses[1].length;

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;

      let source = scriptSourceFromLine(raw);
      let sourceLineIndex = child;
      if (source === null) {
        const keyIndent = explicitScriptKey(raw);
        if (keyIndent !== null && child + 1 < lines.length) {
          source = explicitScriptValue(lines[child + 1], keyIndent);
          if (source !== null) sourceLineIndex = child + 1;
        }
      }
      if (source === null) continue;

      if (blockScalarHeader(stripYamlComment(source).trim())) {
        const scriptIndent = indentOf(lines[sourceLineIndex]);
        const body: string[] = [];
        for (let bodyIndex = sourceLineIndex + 1; bodyIndex < lines.length; bodyIndex += 1) {
          const bodyLine = lines[bodyIndex];
          if (bodyLine.trim() && indentOf(bodyLine) <= scriptIndent) break;
          body.push(bodyLine);
        }
        sources.push(body.join('\n'));
      } else {
        sources.push(source);
      }
      break;
    }
  }

  return sources;
};

const expectNoUntrustedGithubScriptSource = (workflow: string, source: string) => {
  for (const scriptSource of collectGithubScriptSources(workflow)) {
    expect(
      isUntrustedGithubScriptSource(scriptSource),
      `${source}: attacker-controlled GitHub text becomes the GitHub Script source`,
    ).toBe(false);
  }
};

describe('GitHub Script source trust policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedGithubScriptSource(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects attacker-controlled text used directly as the script source', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: ${{ github.event.comment.body }}',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'direct-source.yml')).toThrow();
  });

  it('rejects pull-request head refs used directly as GitHub Script source', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: ${{ github.head_ref }}',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'head-ref-source.yml')).toThrow();
  });

  it('rejects bracket-form pull-request head refs used as GitHub Script source', () => {
    const unsafe = [
      'on: pull_request_target',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      "          script: ${{ github['head_ref'] }}",
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'head-ref-bracket-source.yml')).toThrow();
  });

  it('rejects quoted YAML script keys', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          "script": ${{ github.event.comment.body }}',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'quoted-script-key.yml')).toThrow();
  });

  it('rejects explicit YAML script keys', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          ? script',
      '          : ${{ github.event.comment.body }}',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'explicit-script-key.yml')).toThrow();
  });

  it('rejects the same sink in a flow-style with mapping', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with: { "script": "${{ github.event.issue.body }}" }',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'flow-source.yml')).toThrow();
  });

  it('rejects attacker-controlled script source in a flow-style step mapping', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - { uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { script: "${{ github.event.comment.body }}" } }',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'flow-step-source.yml')).toThrow();
  });

  it('rejects untrusted expressions embedded in an inline script body', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const body = "${{ github.event.comment.body }}";',
      '            core.info(body);',
    ].join('\n');
    expect(() => expectNoUntrustedGithubScriptSource(unsafe, 'embedded-source.yml')).toThrow();
  });

  it('allows a repository-owned constant script source', () => {
    const safe = [
      'on: pull_request_target',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      "          script: core.info('safe')",
    ].join('\n');
    expectNoUntrustedGithubScriptSource(safe, 'constant-source.yml');
  });

  it('allows a repository-owned constant through an explicit YAML script key', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          ? script',
      "          : core.info('safe')",
    ].join('\n');
    expectNoUntrustedGithubScriptSource(safe, 'explicit-constant-source.yml');
  });

  it('allows payload text read as data inside a fixed script body', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
    ].join('\n');
    expectNoUntrustedGithubScriptSource(safe, 'data-only.yml');
  });
});
