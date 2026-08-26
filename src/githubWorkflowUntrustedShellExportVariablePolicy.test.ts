import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\.\s*\[\s*(['"])([A-Za-z_][A-Za-z0-9_-]*)\1\s*\]/g, '.$2')
  .replace(/\[\s*(['"])([A-Za-z_][A-Za-z0-9_-]*)\1\s*\]/g, '.$2')
  .replace(/\?\./g, '.');

const untrustedPayloadPattern = /(?:github\.event\.(?:issue|comment|pull_request|review|review_comment)\.(?:title|body)|context\.payload\.(?:issue|comment|pull_request|review|review_comment)\.(?:title|body))/;

const exportedUntrustedVariables = (workflow: string) => {
  const variables = new Set<string>();
  const aliases = new Set<string>();
  const assignments = [...workflow.matchAll(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n]+)/g)]
    .map((match) => ({ name: match[1], value: normalizePayloadAccess(match[2].trim()) }));

  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      const isDirectlyUntrusted = untrustedPayloadPattern.test(assignment.value);
      const isAliasedUntrusted = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(assignment.value) && aliases.has(assignment.value);
      if ((isDirectlyUntrusted || isAliasedUntrusted) && !aliases.has(assignment.name)) {
        aliases.add(assignment.name);
        changed = true;
      }
    }
  }

  const exportPattern = /core\.exportVariable\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*,\s*([\s\S]*?)\)/g;
  for (const match of workflow.matchAll(exportPattern)) {
    const value = normalizePayloadAccess(match[3].trim());
    if (untrustedPayloadPattern.test(value) || aliases.has(value)) variables.add(match[2]);
  }
  return variables;
};

const shellReferencesVariable = (workflow: string, variable: string) => {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shellPattern = new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?::[^}]*)?\\}|%${escaped}%|\\$env:${escaped}\\b|\\$\\{\\{\\s*env\\.${escaped}\\s*\\}\\})`, 'i');
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const runMatch = lines[index].match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!runMatch) continue;
    let script = runMatch[1];
    if (/^[|>][+-]?\d?\s*$/.test(script.trim())) {
      const runIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
      const body: string[] = [];
      for (let child = index + 1; child < lines.length; child += 1) {
        const indent = lines[child].match(/^\s*/)?.[0].length ?? 0;
        if (lines[child].trim() && indent <= runIndent) break;
        body.push(lines[child].trim());
      }
      script = body.join('\n');
    }
    if (shellPattern.test(script)) return true;
  }
  return false;
};

const expectNoExportedUntrustedShellValues = (workflow: string, source: string) => {
  for (const variable of exportedUntrustedVariables(workflow)) {
    expect(shellReferencesVariable(workflow, variable), `${source}: exported ${variable} reaches a shell run step`).toBe(false);
  }
};

describe('GitHub Script exported-variable shell boundary policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoExportedUntrustedShellValues(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects comment text exported through GITHUB_ENV before shell execution', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        core.exportVariable('CMD', context.payload.comment.body)",
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoExportedUntrustedShellValues(unsafe, 'exported-comment.yml')).toThrow();
  });

  it('rejects chained local aliases of untrusted payload text before export', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      '        const raw = context.payload.comment.body;',
      '        const command = raw;',
      "        core.exportVariable('CMD', command)",
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoExportedUntrustedShellValues(unsafe, 'exported-alias.yml')).toThrow();
  });

  it('rejects computed optional-chained payload text exported to shell', () => {
    const unsafe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        core.exportVariable('CMD', context.payload.comment?.['body'])",
      '  - run: call %CMD%',
    ].join('\n');
    expect(() => expectNoExportedUntrustedShellValues(unsafe, 'exported-optional-chain.yml')).toThrow();
  });

  it('accepts exported values that do not originate from untrusted event text', () => {
    const safe = [
      'steps:',
      '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '    with:',
      '      script: |',
      "        core.exportVariable('CMD', 'echo safe')",
      '  - run: bash -c "$CMD"',
    ].join('\n');
    expectNoExportedUntrustedShellValues(safe, 'exported-safe.yml');
  });
});
