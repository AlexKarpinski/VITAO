import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const untrustedPayload = /(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/;
const executionSink = /\b(?:exec|execSync|spawn|spawnSync|execFile|execFileSync|execa|execaSync|eval)\s*\(/;

const collectQuotedGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*(?:"uses"|'uses')\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
    if (!uses) continue;
    const stepIndent = uses[1].length;

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;

      const script = raw.match(/^\s*script\s*:\s*(.*)$/);
      if (!script) continue;
      const value = script[1].trim();
      if (value && !/^[|>][+-]?\d*\s*$/.test(value)) {
        bodies.push(value);
        break;
      }

      const body: string[] = [];
      const scriptIndent = indent;
      for (let bodyIndex = child + 1; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyRaw = lines[bodyIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = bodyIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }

  return bodies;
};

const expectQuotedGithubScriptSafe = (workflow: string, source: string) => {
  for (const body of collectQuotedGithubScriptBodies(workflow)) {
    const normalized = body
      .replace(/\?\./g, '.')
      .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');
    expect(
      executionSink.test(normalized) && untrustedPayload.test(normalized),
      `${source}: quoted uses key hides attacker-controlled GitHub Script execution`,
    ).toBe(false);
  }
};

describe('quoted GitHub Script uses keys', () => {
  it('rejects attacker-controlled execution behind a double-quoted uses key', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - "uses": actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            require('node:child_process').execSync(context.payload.comment.body);",
    ].join('\n');

    expect(() => expectQuotedGithubScriptSafe(unsafe, 'double-quoted.yml')).toThrow();
  });

  it('rejects attacker-controlled execution behind a single-quoted uses key', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      "      - 'uses': actions/github-script@0123456789abcdef0123456789abcdef01234567",
      '        with:',
      '          script: |',
      "            require('node:child_process').spawnSync('bash', ['-c', github.event.issue.body]);",
    ].join('\n');

    expect(() => expectQuotedGithubScriptSafe(unsafe, 'single-quoted.yml')).toThrow();
  });

  it('allows quoted uses keys when payload text is only logged as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - "uses": actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            core.info(context.payload.comment.body);',
    ].join('\n');

    expectQuotedGithubScriptSafe(safe, 'safe.yml');
  });

  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectQuotedGithubScriptSafe(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
