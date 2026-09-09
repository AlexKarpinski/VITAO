import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = join(process.cwd(), '.github', 'workflows');
const workflowFiles = readdirSync(workflowsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
  .map((entry) => entry.name);

const untrustedPayloadPattern =
  /(?:context\.payload|github\.event)\.(?:issue|comment|pull_request|review|discussion)\.(?:title|body)\b/i;

const normalizeJavaScript = (script: string) =>
  script
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s*\?\.\s*/g, '.')
    .replace(/\[\s*(['"])([^'"]+)\1\s*\]/g, '.$2');

const readBalancedCall = (script: string, openParen: number) => {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openParen; index < script.length; index += 1) {
    const char = script[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return script.slice(openParen + 1, index);
    }
  }

  return null;
};

const collectTaintedIdentifiers = (script: string) => {
  const tainted = new Set<string>();
  const declarations = [
    ...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g),
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      const [, name, expression] = declaration;
      if (tainted.has(name)) continue;
      const referencesTainted = [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(expression),
      );
      if (untrustedPayloadPattern.test(expression) || referencesTainted) {
        tainted.add(name);
        changed = true;
      }
    }
  }

  return tainted;
};

const containsUntrustedParenthesizedShellCall = (script: string) => {
  const normalized = normalizeJavaScript(script);
  const tainted = collectTaintedIdentifiers(normalized);
  const parenthesizedCallPattern =
    /\(\s*(?:(?:[A-Za-z_$][\w$]*)\s*\.\s*)?(execSync|exec)\s*\)\s*\(/g;

  for (const match of normalized.matchAll(parenthesizedCallPattern)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf('(');
    const args = readBalancedCall(normalized, openParen);
    if (args === null) continue;
    if (untrustedPayloadPattern.test(args)) return true;
    if (
      [...tainted].some((identifier) =>
        new RegExp(`\\b${identifier.replace(/[$]/g, '\\$&')}\\b`).test(args),
      )
    ) {
      return true;
    }
  }

  return false;
};

const collectGitHubScripts = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/uses:\s*actions\/github-script@/i.test(lines[index])) continue;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*-\s+(?:name:|uses:|run:)/.test(lines[cursor])) break;
      const scriptMatch = lines[cursor].match(/^(\s*)script:\s*\|[-+]?\s*$/);
      if (!scriptMatch) continue;
      const baseIndent = scriptMatch[1].length;
      const body: string[] = [];
      cursor += 1;
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line.trim() && line.match(/^\s*/)?.[0].length! <= baseIndent) break;
        body.push(line.slice(Math.min(line.length, baseIndent + 2)));
        cursor += 1;
      }
      scripts.push(body.join('\n'));
      break;
    }
  }
  return scripts;
};

describe('GitHub Script parenthesized child-process call policy', () => {
  it('does not execute attacker-controlled text through a parenthesized shell sink', () => {
    for (const file of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, file), 'utf8');
      for (const script of collectGitHubScripts(workflow)) {
        expect(containsUntrustedParenthesizedShellCall(script), file).toBe(false);
      }
    }
  });

  it('rejects a parenthesized execSync call with direct payload text', () => {
    expect(
      containsUntrustedParenthesizedShellCall(
        '(cp.execSync)(context.payload.comment.body);',
      ),
    ).toBe(true);
  });

  it('rejects a parenthesized exec call through a tainted local alias', () => {
    expect(
      containsUntrustedParenthesizedShellCall(
        'const command = github.event.issue.title; (childProcess.exec)(command);',
      ),
    ).toBe(true);
  });

  it('allows repository-owned commands in parenthesized shell calls', () => {
    expect(
      containsUntrustedParenthesizedShellCall(
        'console.log(context.payload.comment.body); (cp.execSync)("npm test");',
      ),
    ).toBe(false);
  });
});
