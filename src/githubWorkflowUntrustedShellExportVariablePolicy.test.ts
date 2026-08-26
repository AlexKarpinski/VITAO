import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedPayloadPattern = /(?:github\.event\.(?:issue|comment|pull_request|review|review_comment)(?:\?\.)?\.(?:title|body)|context\.payload\.(?:issue|comment|pull_request|review|review_comment)(?:\?\.)?\.(?:title|body))/;

const exportedUntrustedVariables = (workflow: string) => {
  const variables = new Set<string>();
  const exportPattern = /core\.exportVariable\(\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*,\s*([\s\S]*?)\)/g;
  for (const match of workflow.matchAll(exportPattern)) {
    if (untrustedPayloadPattern.test(match[3])) variables.add(match[2]);
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
