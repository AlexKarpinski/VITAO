import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\]/g, '.$1');

const containsUntrustedPayload = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/
    .test(normalizeAccess(value));

const expectNoUntrustedGithubEnvWrite = (workflow: string, source: string) => {
  const scripts = [...workflow.matchAll(/script:\s*\|\s*\n((?:\s{10,}.*\n?)*)/g)].map((match) => match[1]);
  for (const script of scripts) {
    if (!/process\.env\.GITHUB_ENV/.test(script)) continue;
    expect(containsUntrustedPayload(script), `${source}: untrusted payload written to GITHUB_ENV`).toBe(false);
  }
};

describe('GitHub workflow GITHUB_ENV trust boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedGithubEnvWrite(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects direct writes of untrusted comment text to GITHUB_ENV', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      "            fs.appendFileSync(process.env.GITHUB_ENV, `CMD=${context.payload.comment.body}\\n`);",
      '      - run: bash -c "$CMD"',
    ].join('\n');
    expect(() => expectNoUntrustedGithubEnvWrite(unsafe, 'unsafe.yml')).toThrow();
  });

  it('allows constant data to be written to GITHUB_ENV', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      "            fs.appendFileSync(process.env.GITHUB_ENV, 'MODE=safe\\n');",
    ].join('\n');
    expectNoUntrustedGithubEnvWrite(safe, 'safe.yml');
  });
});
