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

const collectGithubScriptBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const scripts: string[] = [];
  const scalarHeader = /^(\s*)script:\s*[|>](?:[1-9][+-]?|[+-][1-9]?|[+-]?)?\s*(?:#.*)?$/;

  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(scalarHeader);
    if (!header) continue;

    const baseIndent = header[1].length;
    const body: string[] = [];
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === '') {
        body.push(line);
        continue;
      }

      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        i -= 1;
        break;
      }
      body.push(line);
    }
    scripts.push(body.join('\n'));
  }

  return scripts;
};

const collectGithubEnvWriteValues = (script: string) => {
  const values: string[] = [];
  const writeCall = /(?:appendFileSync|writeFileSync|appendFile|writeFile)\s*\(\s*process\.env\.GITHUB_ENV\s*,\s*([^\n;]+?)(?:\s*,\s*[^\n;]+)?\s*\)\s*;?/g;

  for (const match of script.matchAll(writeCall)) {
    values.push(match[1].trim());
  }
  return values;
};

const expectNoUntrustedGithubEnvWrite = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBlocks(workflow)) {
    for (const value of collectGithubEnvWriteValues(script)) {
      expect(containsUntrustedPayload(value), `${source}: untrusted payload written to GITHUB_ENV`).toBe(false);
    }
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

  it('rejects untrusted GITHUB_ENV writes in chomping and indentation block scalars', () => {
    for (const header of ['|-', '|+', '>2+', '>2-']) {
      const unsafe = [
        'jobs:',
        '  test:',
        '    steps:',
        '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
        '        with:',
        `          script: ${header}`,
        "            const fs = require('node:fs');",
        "            fs.appendFileSync(process.env.GITHUB_ENV, `CMD=${context.payload.comment.body}\\n`);",
        '      - run: bash -c "$CMD"',
      ].join('\n');
      expect(() => expectNoUntrustedGithubEnvWrite(unsafe, `${header}.yml`)).toThrow();
    }
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

  it('allows unrelated payload reads beside constant GITHUB_ENV writes', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      '            core.info(context.payload.comment.body);',
      "            fs.appendFileSync(process.env.GITHUB_ENV, 'MODE=safe\\n');",
    ].join('\n');
    expectNoUntrustedGithubEnvWrite(safe, 'safe-unrelated-read.yml');
  });
});
