import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();

const untrustedPayloadRead = /(?:\b(?:cat|head|tail|sed|awk|grep)\b[^\n]*\$\{?GITHUB_EVENT_PATH\}?|\bjq\b[^\n]*(?:\$\{?GITHUB_EVENT_PATH\}?|env\.GITHUB_EVENT_PATH)|\b(?:node|python(?:3)?|ruby|perl)\b[^\n]*(?:GITHUB_EVENT_PATH|github\.event))/i;
const executionSink = /(?:\beval\b|\bbash\s+-c\b|\bsh\s+-c\b|\bzsh\s+-c\b|\bpwsh\b[^\n]*-Command\b|\bInvoke-Expression\b|\bcmd(?:\.exe)?\b[^\n]*\/c\b)/i;

const shellValue = (line: string) => {
  const run = line.match(/^\s*(?:-\s*)?["']?run["']?\s*:\s*(.*)$/i);
  if (run) return run[1];
  const shell = line.match(/^\s*["']?shell["']?\s*:\s*(.*)$/i);
  return shell?.[1] ?? null;
};

const assertNoEventPathReadExecution = (workflow: string) => {
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const value = shellValue(lines[index]);
    if (value !== null && untrustedPayloadRead.test(value) && executionSink.test(value)) {
      throw new Error('GITHUB_EVENT_PATH content reaches a shell execution sink');
    }

    if (value === null || !/[|>]\s*[+-]?[1-9]?\s*$/.test(value.trim())) continue;
    const indent = lines[index].match(/^\s*/)?.[0].length ?? 0;
    const body: string[] = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childIndent = lines[child].match(/^\s*/)?.[0].length ?? 0;
      if (lines[child].trim() && childIndent <= indent) break;
      body.push(lines[child]);
      index = child;
    }
    const script = body.join('\n');
    if (untrustedPayloadRead.test(script) && executionSink.test(script)) {
      throw new Error('GITHUB_EVENT_PATH content reaches a shell execution sink');
    }
  }
};

describe('GitHub event payload file shell boundary', () => {
  it('rejects command execution sourced directly from GITHUB_EVENT_PATH', () => {
    const unsafe = [
      'steps:',
      `  - run: bash -c "$(jq -r '.comment.body' \"$GITHUB_EVENT_PATH\")"`,
    ].join('\n');
    expect(() => assertNoEventPathReadExecution(unsafe)).toThrow();
  });

  it('rejects block scripts that read the event payload and eval it', () => {
    const unsafe = [
      'steps:',
      '  - run: |',
      `      CMD=$(jq -r '.issue.body' "$GITHUB_EVENT_PATH")`,
      '      eval "$CMD"',
    ].join('\n');
    expect(() => assertNoEventPathReadExecution(unsafe)).toThrow();
  });

  it('allows payload data reads that are not executed as commands', () => {
    const safe = [
      'steps:',
      '  - run: |',
      `      TITLE=$(jq -r '.issue.title' "$GITHUB_EVENT_PATH")`,
      '      printf "%s\\n" "$TITLE"',
    ].join('\n');
    expect(() => assertNoEventPathReadExecution(safe)).not.toThrow();
  });

  it('checks every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) assertNoEventPathReadExecution(readFileSync(join(workflowsDir, file), 'utf8'));
  });
});
