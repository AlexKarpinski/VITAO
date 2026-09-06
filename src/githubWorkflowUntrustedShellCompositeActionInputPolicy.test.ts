import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const actionRoots = ['.github/actions'];

const actionFiles = () => {
  const files: string[] = [];
  const visit = (path: string) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      if (statSync(child).isDirectory()) visit(child);
      else if (/action\.ya?ml$/.test(entry)) files.push(child);
    }
  };
  for (const root of actionRoots) visit(root);
  return files.sort();
};

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const directInputExpression = /\$\{\{\s*inputs(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[['"][^'"\]]+['"]\])\s*\}\}/;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;
const untrustedGithubScriptPayload =
  /context\s*\.\s*payload\s*\.\s*(?:comment|issue|pull_request|review|discussion)\s*\.\s*(?:body|title|diff_hunk)\b/i;
const githubScriptShellCall =
  /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*context\s*\.\s*payload\s*\.\s*(?:comment|issue|pull_request|review|discussion)\s*\.\s*(?:body|title|diff_hunk)\b/i;

const collectUnsafeCompositeRuns = (action: string) => {
  const lines = action.split('\n');
  const unsafe: string[] = [];
  let composite = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (/^using\s*:\s*['"]?composite['"]?\s*$/.test(trimmed)) composite = true;
  }
  if (!composite) return unsafe;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const run = raw.match(/^\s*-?\s*run\s*:\s*(.*)$/);
    if (!run) continue;
    const value = run[1].trim();
    if (blockHeader.test(value)) {
      const parentIndent = indentOf(raw);
      const body: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const childRaw = lines[child];
        if (childRaw.trim() && indentOf(childRaw) <= parentIndent) break;
        body.push(childRaw);
        index = child;
      }
      const script = body.join('\n');
      if (directInputExpression.test(script)) unsafe.push(script);
      continue;
    }
    if (directInputExpression.test(value)) unsafe.push(value);
  }
  return unsafe;
};

const collectUnsafeCompositeGithubScripts = (action: string) => {
  const lines = action.split('\n');
  const unsafe: string[] = [];
  const composite = lines.some((line) => /^\s*using\s*:\s*['"]?composite['"]?\s*$/.test(line));
  if (!composite) return unsafe;

  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^'"\s]+['"]?\s*$/i);
    if (!uses) continue;

    const stepIndent = uses[1].length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const raw = lines[cursor];
      if (raw.trim() && indentOf(raw) <= stepIndent) break;
      const script = raw.match(/^(\s*)script\s*:\s*(.*)$/);
      if (!script) continue;

      const value = script[2].trim();
      if (!blockHeader.test(value)) {
        if (githubScriptShellCall.test(value)) unsafe.push(value);
        continue;
      }

      const scriptIndent = script[1].length;
      const body: string[] = [];
      for (let child = cursor + 1; child < lines.length; child += 1) {
        const childRaw = lines[child];
        if (childRaw.trim() && indentOf(childRaw) <= scriptIndent) break;
        body.push(childRaw);
        cursor = child;
      }
      const source = body.join('\n');
      if (untrustedGithubScriptPayload.test(source) && githubScriptShellCall.test(source)) unsafe.push(source);
    }
  }

  return unsafe;
};

const expectCompositeInputsSeparatedFromShell = (action: string, source: string) => {
  expect(collectUnsafeCompositeRuns(action), source).toEqual([]);
  expect(collectUnsafeCompositeGithubScripts(action), source).toEqual([]);
};

describe('local composite action shell-input policy', () => {
  it('scans checked-in local composite actions when present', () => {
    for (const file of actionFiles()) {
      expectCompositeInputsSeparatedFromShell(readFileSync(file, 'utf8'), file);
    }
  });

  it('rejects direct interpolation of a composite input into a shell script', () => {
    const unsafe = [
      'name: unsafe',
      'inputs:',
      '  command:',
      '    required: true',
      'runs:',
      '  using: composite',
      '  steps:',
      '    - shell: bash',
      '      run: |',
      '        bash -c "${{ inputs.command }}"',
    ].join('\n');
    expect(() => expectCompositeInputsSeparatedFromShell(unsafe, 'action.yml')).toThrow();
  });

  it('rejects bracket-form input access in a composite run', () => {
    const unsafe = [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - shell: bash',
      `      run: eval "\${{ inputs['command'] }}"`,
    ].join('\n');
    expect(() => expectCompositeInputsSeparatedFromShell(unsafe, 'action.yml')).toThrow();
  });

  it('rejects untrusted event text executed by github-script inside a composite action', () => {
    const unsafe = [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - uses: actions/github-script@v8',
      '      with:',
      '        script: |',
      "          const { execSync } = require('node:child_process');",
      '          execSync(context.payload.comment.body);',
    ].join('\n');
    expect(() => expectCompositeInputsSeparatedFromShell(unsafe, 'action.yml')).toThrow();
  });

  it('allows github-script to inspect untrusted text without executing it', () => {
    const safe = [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - uses: actions/github-script@v8',
      '      with:',
      '        script: |',
      "          const { execSync } = require('node:child_process');",
      '          core.info(context.payload.comment.body);',
      "          execSync('printf safe');",
    ].join('\n');
    expectCompositeInputsSeparatedFromShell(safe, 'action.yml');
  });

  it('allows input transport through env when shell text does not interpolate expressions', () => {
    const safe = [
      'runs:',
      '  using: composite',
      '  steps:',
      '    - shell: bash',
      '      env:',
      '        ARG: ${{ inputs.value }}',
      '      run: |',
      `        printf '%s\\n' "$ARG"`,
    ].join('\n');
    expectCompositeInputsSeparatedFromShell(safe, 'action.yml');
  });

  it('ignores JavaScript actions because their inputs are not shell source', () => {
    const safe = ['runs:', '  using: node20', '  main: index.js'].join('\n');
    expectCompositeInputsSeparatedFromShell(safe, 'action.yml');
  });
});
