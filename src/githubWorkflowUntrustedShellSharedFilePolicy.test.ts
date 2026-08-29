import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const untrustedPayload = /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body)|review(?:_comment)?\.body)/;

const collectTaintedFileWrites = (workflow: string) => {
  const paths = new Set<string>();
  const write = /(?:(?:writeFileSync|appendFileSync)|(?:fs\.)?promises\.(?:writeFile|appendFile))\(\s*['"]([^'"]+)['"]\s*,([^\n;]+)/g;
  for (const match of workflow.matchAll(write)) {
    if (untrustedPayload.test(match[2])) paths.add(match[1]);
  }
  return paths;
};

const executesFile = (workflow: string, path: string) => {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\n;]|&&|\\|\\|)\\s*(?:-\\s+)?(?:run:\\s*)?(?:source|\\.)\\s+(?:['"])?${escaped}(?:['"])?(?=\\s|$)`, 'm').test(workflow);
};

const expectNoUntrustedSharedFileExecution = (workflow: string, source: string) => {
  for (const path of collectTaintedFileWrites(workflow)) {
    expect(executesFile(workflow, path), `${source}: attacker-derived file ${path} is later executed`).toBe(false);
  }
};

describe('GitHub workflow shared-file shell trust boundary', () => {
  it('rejects attacker-derived files sourced by a later step', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      "            fs.writeFileSync('/tmp/command.sh', context.payload.comment.body);",
      '      - run: source /tmp/command.sh',
    ].join('\n');
    expect(() => expectNoUntrustedSharedFileExecution(unsafe, 'unsafe.yml')).toThrow();
  });

  it('rejects attacker-derived files written asynchronously and sourced later', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      "            await fs.promises.writeFile('/tmp/command.sh', context.payload.comment.body);",
      '      - run: source /tmp/command.sh',
    ].join('\n');
    expect(() => expectNoUntrustedSharedFileExecution(unsafe, 'unsafe-async.yml')).toThrow();
  });

  it('allows sourcing a file written only with constant data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const fs = require('node:fs');",
      "            fs.writeFileSync('/tmp/command.sh', 'echo safe');",
      '      - run: source /tmp/command.sh',
    ].join('\n');
    expect(() => expectNoUntrustedSharedFileExecution(safe, 'safe.yml')).not.toThrow();
  });

  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoUntrustedSharedFileExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
