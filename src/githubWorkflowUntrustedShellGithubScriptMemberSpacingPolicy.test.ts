import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*(?:uses|"uses"|'uses')\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*(?:script|"script"|'script')\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let bodyIndex = child + 1; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyLine = lines[bodyIndex];
        if (bodyLine.trim() && indentOf(bodyLine) <= scriptIndent) break;
        body.push(bodyLine);
        child = bodyIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const normalizeMemberSpacing = (value: string) => value
  .replace(/\s*\?\.\s*/g, '.')
  .replace(/\s*\.\s*/g, '.');

const untrustedPayload = String.raw`(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|discussion\.(?:title|body))`;
const directExecution = new RegExp(String.raw`\b(?:exec|execSync)\s*(?:\?\.\s*)?\(\s*${untrustedPayload}\b`);

const expectNoSpacedMemberExecution = (workflow: string, source: string) => {
  for (const body of collectGithubScriptBodies(workflow)) {
    expect(
      directExecution.test(normalizeMemberSpacing(body)),
      `${source}: spaced JavaScript member access sends attacker-controlled text to a shell execution API`,
    ).toBe(false);
  }
};

describe('GitHub Script member-spacing trust policy', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoSpacedMemberExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects payload members split across lines before execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context",
      '              .payload',
      '              .comment',
      '              .body);',
    ].join('\n');
    expect(() => expectNoSpacedMemberExecution(unsafe, 'spaced-members.yml')).toThrow();
  });

  it('accepts payload text that is only logged as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context',
      '              .payload',
      '              .comment',
      '              .body);',
    ].join('\n');
    expectNoSpacedMemberExecution(safe, 'spaced-members-data.yml');
  });
});
