import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const normalizePayloadAccess = (value: string) => value
  .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized)
    || /github\.event\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body|head\.(?:ref|label))|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const collectTaintedMemberExpressions = (script: string) => {
  const tainted = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const match of script.matchAll(/\b([A-Za-z_$][\w$]*(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\]))+)\s*=\s*([^;\n]+)/g)) {
      const target = normalizePayloadAccess(match[1]).replace(/\s+/g, '');
      const value = normalizePayloadAccess(match[2]);
      const derivesFromTaintedMember = [...tainted].some((member) => new RegExp(`(^|[^\\w$])${member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w$]|$)`).test(value));
      if ((containsUntrustedPayloadText(value) || derivesFromTaintedMember) && !tainted.has(target)) {
        tainted.add(target);
        changed = true;
      }
    }
  }

  return tainted;
};

const hasMemberAssignmentShellExecution = (script: string) => {
  const taintedMembers = collectTaintedMemberExpressions(script);
  if (taintedMembers.size === 0) return false;

  for (const match of script.matchAll(/\b(?:exec|execSync)\s*(?:\?\.)?\s*\(([^)]+)\)/g)) {
    const command = normalizePayloadAccess(match[1].split(',')[0] ?? '').replace(/\s+/g, '');
    if ([...taintedMembers].some((member) => command.includes(member))) return true;
  }
  return false;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const uses = lines[index].match(/^(\s*)-?\s*(?:['"]uses['"]|uses)\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*(?:#.*)?$/i);
    if (!uses) continue;
    const stepIndent = uses[1].length;

    for (let child = index + 1; child < lines.length; child += 1) {
      const raw = lines[child];
      const trimmed = raw.trim();
      const indent = indentOf(raw);
      if (trimmed && indent <= stepIndent && /^-\s+/.test(trimmed)) break;
      const script = raw.match(/^\s*(?:['"]script['"]|script)\s*:\s*(.*)$/);
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

const expectNoMemberAssignmentShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasMemberAssignmentShellExecution(script),
      `${source}: attacker-controlled GitHub text assigned to an object property reaches a shell execution API`,
    ).toBe(false);
  }
};

describe('GitHub Script member-assignment shell boundary', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoMemberAssignmentShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects comment text assigned to an object property before execSync', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const holder = {};',
      '            holder.command = context.payload.comment.body;',
      "            require('node:child_process').execSync(holder.command);",
    ].join('\n');
    expect(() => expectNoMemberAssignmentShellExecution(unsafe, 'member-assignment.yml')).toThrow();
  });

  it('rejects bracket-member assignments before exec', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const holder = {};',
      "            holder['command'] = context.payload.issue.body;",
      "            require('node:child_process').exec(holder.command);",
    ].join('\n');
    expect(() => expectNoMemberAssignmentShellExecution(unsafe, 'bracket-member-assignment.yml')).toThrow();
  });

  it('allows payload logging beside a constant member command', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            const holder = {};',
      "            holder.command = 'printf safe';",
      '            core.info(context.payload.comment.body);',
      "            require('node:child_process').execSync(holder.command);",
    ].join('\n');
    expectNoMemberAssignmentShellExecution(safe, 'safe-member-assignment.yml');
  });
});
