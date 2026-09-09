import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const blockHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?\s*$/;

const stripYamlComment = (line: string) => {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (!quote) {
      if (char === '"' || char === "'") quote = char;
      else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
      continue;
    }
    if (char !== quote) continue;
    if (quote === "'" && line[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (quote === '"') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) backslashes += 1;
      if (backslashes % 2 === 1) continue;
    }
    quote = null;
  }
  return line;
};

const collectGithubScriptBodies = (workflow: string) => {
  const bodies: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const usesLine = stripYamlComment(lines[index]);
    const uses = usesLine.match(/^(\s*)-?\s*uses\s*:\s*['"]?actions\/github-script@[^\s'"]+['"]?\s*$/);
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

const normalizePayloadAccess = (value: string) => value
  .replace(/\?\./g, '.')
  .replace(/\[\s*['"]([A-Za-z_][A-Za-z0-9_-]*)['"]\s*\]/g, '.$1');

const containsUntrustedPayloadText = (value: string) => {
  const normalized = normalizePayloadAccess(value);
  return /context\.payload\.(?:issue\.(?:title|body)|comment\.(?:body|diff_hunk|path)|pull_request\.(?:title|body)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalized);
};

const referencesTaintedIdentifier = (value: string, tainted: Set<string>) =>
  [...tainted].some((identifier) => new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(value));

const hasReassignmentShellExecution = (script: string) => {
  const tainted = new Set<string>();
  const statements = script.split(/;|\n/).map((statement) => statement.trim()).filter(Boolean);

  for (const statement of statements) {
    const binding = statement.match(/^(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(?![=>])(.+)$/);
    if (binding) {
      const [, identifier, expression] = binding;
      if (containsUntrustedPayloadText(expression) || referencesTaintedIdentifier(expression, tainted)) tainted.add(identifier);
      else tainted.delete(identifier);
      continue;
    }

    const exec = statement.match(/(?:\b[A-Za-z_$][\w$]*\s*\.\s*)?\b(?:exec|execSync)\s*\(\s*(.+)$/);
    if (!exec) continue;
    const argument = exec[1];
    if (containsUntrustedPayloadText(argument) || referencesTaintedIdentifier(argument, tainted)) return true;
  }

  return false;
};

const expectNoReassignedGithubScriptShellExecution = (workflow: string, source: string) => {
  for (const script of collectGithubScriptBodies(workflow)) {
    expect(
      hasReassignmentShellExecution(script),
      `${source}: GitHub Script executes event text after identifier reassignment`,
    ).toBe(false);
  }
};

describe('GitHub Script reassignment shell trust boundary', () => {
  it('rejects identifiers reassigned from safe text to attacker-controlled text', () => {
    const unsafe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      "            let command = 'echo safe';",
      '            command = context.payload.comment.body;',
      "            require('node:child_process').execSync(command);",
    ].join('\n');
    expect(() => expectNoReassignedGithubScriptShellExecution(unsafe, 'reassigned.yml')).toThrow();
  });

  it('allows a tainted identifier overwritten by a constant before execution', () => {
    const safe = [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567',
      '        with:',
      '          script: |',
      '            let command = context.payload.comment.body;',
      "            command = 'printf safe';",
      "            require('node:child_process').execSync(command);",
    ].join('\n');
    expectNoReassignedGithubScriptShellExecution(safe, 'overwritten.yml');
  });

  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoReassignedGithubScriptShellExecution(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });
});
