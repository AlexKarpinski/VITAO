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

const stripYamlComment = (value: string) => {
  let quote: '"' | "'" | null = null;
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === '\\') { backslashes += 1; continue; }
      if (char === quote && (quote === "'" || backslashes % 2 === 0)) quote = null;
      backslashes = 0;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; backslashes = 0; continue; }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
};

const unquote = (raw: string) => {
  const value = stripYamlComment(raw).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;
const scalarHeader = /^[|>](?:(?:[+-][1-9]?)|(?:[1-9][+-]?))?$/;

const collectScalar = (lines: string[], start: number, parentIndent: number) => {
  const body: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && indentOf(line) <= parentIndent) break;
    body.push(line.trim());
    end = index;
  }
  return { value: body.join('\n'), end };
};

const collectRuns = (workflow: string) => {
  const scripts: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = stripYamlComment(raw);
    const match = line.match(/^[ \t]*(?:-[ \t]*)?["']?run["']?[ \t]*:[ \t]*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (scalarHeader.test(value)) {
      const scalar = collectScalar(lines, index, indentOf(raw));
      scripts.push(scalar.value);
      index = scalar.end;
    } else scripts.push(unquote(value));
  }
  return scripts;
};

const containsDirectUntrusted = (value: string) =>
  /(?:github\.event|context\.payload)\.(?:issue\.(?:title|body)|comment\.body|pull_request\.(?:title|body|head\.ref)|review(?:_comment)?\.body|discussion\.(?:title|body))/.test(normalizeAccess(value));

const collectTaintedStepIds = (workflow: string) => {
  const ids = new Set<string>();
  const lines = workflow.split('\n');
  for (let start = 0; start < lines.length; start += 1) {
    const raw = lines[start];
    const sequence = raw.match(/^(\s*)-\s+/);
    if (!sequence) continue;
    const itemIndent = sequence[1].length;
    const block = [raw];
    let end = start;
    for (let index = start + 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (candidate.trim() && indentOf(candidate) <= itemIndent) break;
      block.push(candidate); end = index;
    }
    const text = block.join('\n');
    if (!/uses:\s*["']?actions\/github-script@/i.test(text) || !containsDirectUntrusted(text)) { start = end; continue; }
    const id = text.match(/^\s*(?:-\s*)?id:\s*["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*$/m);
    if (id) ids.add(id[1]);
    start = end;
  }
  return ids;
};

const valueHasTaintedOutput = (value: string, taintedStepIds: Set<string>) => {
  const normalized = normalizeAccess(value);
  for (const match of normalized.matchAll(/steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\.[A-Za-z_][A-Za-z0-9_-]*/g)) {
    if (taintedStepIds.has(match[1])) return true;
  }
  return false;
};

const maybeAddTaintedEnv = (names: Set<string>, rawName: string, rawValue: string, taintedStepIds: Set<string>) => {
  const name = unquote(rawName);
  const value = normalizeAccess(unquote(rawValue));
  if (containsDirectUntrusted(value) || valueHasTaintedOutput(value, taintedStepIds)) names.add(name);
};

const collectDirectTaintedEnv = (workflow: string) => {
  const names = new Set<string>();
  const taintedStepIds = collectTaintedStepIds(workflow);
  for (const rawLine of workflow.split('\n')) {
    const line = stripYamlComment(rawLine);
    const flowEnv = line.match(/^[ \t]*(?:-[ \t]*)?env[ \t]*:[ \t]*\{(.*)\}[ \t]*$/);
    if (flowEnv) {
      for (const entry of flowEnv[1].split(',')) {
        const mapping = entry.match(/^[ \t]*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.+)$/);
        if (mapping) maybeAddTaintedEnv(names, mapping[1], mapping[2], taintedStepIds);
      }
      continue;
    }
    const match = line.match(/^[ \t]*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.+)$/);
    if (match) maybeAddTaintedEnv(names, match[1], match[2], taintedStepIds);
  }
  return names;
};

const expectNoEventPathCommandExecution = (workflow: string, source: string) => {
  for (const script of collectRuns(workflow)) {
    const normalized = normalizeAccess(script);
    if (!/GITHUB_EVENT_PATH/.test(normalized)) continue;
    const readsUntrustedField = /(?:\.comment\.body|\.issue\.(?:title|body)|\.pull_request\.(?:title|body|head\.ref)|\.review(?:_comment)?\.body|\.discussion\.(?:title|body))/.test(normalized);
    const executesRead = /(?:bash\s+-c|sh\s+-c|eval|Invoke-Expression|cmd\s+\/c|call|source\s+<\(|(?:^|[;&|]\s*)\.\s+<\()\b/i.test(normalized);
    expect(readsUntrustedField && executesRead, `${source}: untrusted GITHUB_EVENT_PATH data reaches shell`).toBe(false);
  }
};

const expectNoCommandBasedEnvReads = (workflow: string, source: string) => {
  const tainted = collectDirectTaintedEnv(workflow);
  for (const script of collectRuns(workflow)) {
    for (const name of tainted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const commandRead = new RegExp(`(?:printenv\\s+${escaped}\\b|env\\s+[^\\n]*\\b${escaped}\\b|Get-Item\\s+(?:['"])?Env:${escaped}(?:['"])?\\b)`, 'i');
      const commandSink = /(?:bash\s+-c|sh\s+-c|eval|Invoke-Expression|cmd\s+\/c|call)\b/i;
      expect(commandRead.test(script) && commandSink.test(script), `${source}: command-based read of tainted ${name} reaches shell`).toBe(false);
    }
  }
};

describe('command-based untrusted shell reads', () => {
  it('scans every checked-in workflow', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, file), 'utf8');
      expectNoEventPathCommandExecution(workflow, file);
      expectNoCommandBasedEnvReads(workflow, file);
    }
  });

  it('rejects shell execution of comment text read from GITHUB_EVENT_PATH', () => {
    const unsafe = ['jobs:', '  check:', '    steps:', '      - run: bash -c "$(jq -r \' .comment.body \' \"$GITHUB_EVENT_PATH\")"'].join('\n').replace("' .comment.body '", "'.comment.body'");
    expect(() => expectNoEventPathCommandExecution(unsafe, 'event-path.yml')).toThrow();
  });

  it('rejects sourcing comment text read from GITHUB_EVENT_PATH', () => {
    const unsafe = ['jobs:', '  check:', '    steps:', '      - run: source <(jq -r \' .comment.body \' \"$GITHUB_EVENT_PATH\")'].join('\n').replace("' .comment.body '", "'.comment.body'");
    expect(() => expectNoEventPathCommandExecution(unsafe, 'event-path-source.yml')).toThrow();
  });

  it('rejects command-based reads of directly tainted environment values', () => {
    const unsafe = ['jobs:', '  check:', '    env:', '      CMD: ${{ github.event.comment.body }}', '    steps:', '      - run: bash -c "$(printenv CMD)"'].join('\n');
    expect(() => expectNoCommandBasedEnvReads(unsafe, 'printenv.yml')).toThrow();
  });

  it('rejects quoted PowerShell provider reads of tainted environment values', () => {
    const unsafe = ['jobs:', '  check:', '    env:', '      CMD: ${{ github.event.comment.body }}', '    steps:', "      - run: Invoke-Expression (Get-Item 'Env:CMD').Value"].join('\n');
    expect(() => expectNoCommandBasedEnvReads(unsafe, 'powershell-provider.yml')).toThrow();
  });

  it('rejects command-based reads of tainted github-script outputs routed through env', () => {
    const unsafe = ['jobs:', '  check:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        id: capture', '        with:', '          result-encoding: string', '          script: return context.payload.comment.body', '      - env:', '          CMD: ${{ steps.capture.outputs.result }}', '        run: bash -c "$(printenv CMD)"'].join('\n');
    expect(() => expectNoCommandBasedEnvReads(unsafe, 'output-printenv.yml')).toThrow();
  });

  it('rejects flow env output taint and fallback expressions in command reads', () => {
    const unsafe = ['jobs:', '  check:', '    steps:', '      - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '        id: capture', '        with:', '          result-encoding: string', '          script: return context.payload.comment.body', '      - env: { CMD: "${{ steps.capture.outputs.result || \'echo safe\' }}" }', '        run: bash -c "$(printenv CMD)"'].join('\n');
    expect(() => expectNoCommandBasedEnvReads(unsafe, 'flow-output-printenv.yml')).toThrow();
  });

  it('allows command reads of constant environment values', () => {
    const safe = ['jobs:', '  check:', '    env:', '      CMD: echo-safe', '    steps:', '      - run: printf "%s" "$(printenv CMD)"'].join('\n');
    expectNoCommandBasedEnvReads(safe, 'safe.yml');
  });
});
