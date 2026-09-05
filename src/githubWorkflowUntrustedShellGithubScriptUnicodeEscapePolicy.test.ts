import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const decodeIdentifierEscapes = (source: string) =>
  source
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : _match;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );

const untrustedPayloadMember = String.raw`(?:context\.payload|github\.event)\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))`;
const directShellSink = new RegExp(
  String.raw`(?:^|[^\w$])(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:exec|execSync)\s*(?:\?\.\s*)?\(\s*${untrustedPayloadMember}`,
);

const hasEscapedPayloadShellExecution = (script: string) => directShellSink.test(decodeIdentifierEscapes(script));

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/i);
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
      if (value && !blockHeader.test(value)) {
        bodies.push(value);
        break;
      }
      const body: string[] = [];
      const scriptIndent = indent;
      for (let lineIndex = child + 1; lineIndex < lines.length; lineIndex += 1) {
        const bodyRaw = lines[lineIndex];
        const bodyTrimmed = bodyRaw.trim();
        if (bodyTrimmed && indentOf(bodyRaw) <= scriptIndent) break;
        if (bodyTrimmed) body.push(bodyTrimmed);
        child = lineIndex;
      }
      bodies.push(body.join('\n'));
      break;
    }
  }
  return bodies;
};

const expectNoEscapedPayloadShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasEscapedPayloadShellExecution(script),
      `${source}: GitHub Script hides attacker-controlled shell input behind JavaScript Unicode escapes`,
    ).toBe(false);
  }
};

describe('GitHub Script Unicode-escaped payload trust boundary', () => {
  it('rejects Unicode escapes hiding comment.body in an execSync sink', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      String.raw`            cp.execSync(context.payload.comment.b\u006fdy);`,
    ].join('\n');
    expect(() => expectNoEscapedPayloadShellExecution(unsafe, 'unicode-escape.yml')).toThrow();
  });

  it('rejects braced Unicode escapes hiding comment.body', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            const cp = require('node:child_process');",
      String.raw`            cp.exec(context.payload.comment.b\u{6f}dy);`,
    ].join('\n');
    expect(() => expectNoEscapedPayloadShellExecution(unsafe, 'unicode-braced.yml')).toThrow();
  });

  it('allows escaped payload members when they are consumed only as data', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      String.raw`            console.log(context.payload.comment.b\u006fdy);`,
    ].join('\n');
    expectNoEscapedPayloadShellExecution(safe, 'unicode-safe.yml');
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoEscapedPayloadShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
