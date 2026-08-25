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

const decodeYamlScalar = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try { return JSON.parse(trimmed) as string; } catch { return trimmed; }
  }
  return trimmed;
};

const untrustedParents = [
  'github.event.issue', 'github.event.comment', 'github.event.pull_request', 'github.event.review',
  'github.event.review_comment', 'context.payload.issue', 'context.payload.comment',
  'context.payload.pull_request', 'context.payload.review', 'context.payload.review_comment',
];

const containsUntrustedPayload = (value: string) => {
  const normalized = normalizeAccess(value);
  const leaves = [
    'github.event.issue.title', 'github.event.issue.body', 'github.event.comment.body',
    'github.event.pull_request.title', 'github.event.pull_request.body', 'github.event.review.body',
    'github.event.review_comment.body', 'context.payload.issue.title', 'context.payload.issue.body',
    'context.payload.comment.body', 'context.payload.pull_request.title', 'context.payload.pull_request.body',
    'context.payload.review.body', 'context.payload.review_comment.body',
  ];
  if (leaves.some((expression) => normalized.includes(expression))) return true;
  return untrustedParents.some((parent) => {
    const escaped = parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:const\\s*\\{[^}]+\\}\\s*=\\s*${escaped}\\b|(?:toJSON|toJson)\\s*\\(\\s*${escaped}\\s*\\))`).test(normalized);
  });
};

const isBlockScalarHeader = (value: string) => /^[|>](?:[+-]?[1-9]?|[1-9][+-]?)$/.test(value.trim());

const collectIndentedValue = (lines: string[], startIndex: number, parentIndent: number) => {
  const values: string[] = [];
  let endIndex = startIndex;
  for (let child = startIndex + 1; child < lines.length; child += 1) {
    const line = lines[child];
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (trimmed && indent <= parentIndent) break;
    if (trimmed) values.push(trimmed);
    endIndex = child;
  }
  return { value: values.join('\n'), endIndex };
};

const collectStepBlocks = (workflow: string) => {
  const lines = workflow.split('\n');
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = lines[index].match(/^(\s*)-\s+/);
    if (!start) continue;
    const indent = start[1].length;
    const block = [lines[index]];
    for (let child = index + 1; child < lines.length; child += 1) {
      const childLine = lines[child];
      const childTrimmed = childLine.trim();
      const childIndent = childLine.match(/^\s*/)?.[0].length ?? 0;
      if (childTrimmed && childIndent === indent && /^\s*-\s+/.test(childLine)) break;
      if (childTrimmed && childIndent < indent) break;
      block.push(childLine);
      index = child;
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
};

const extractTaintedStepIds = (workflow: string) => {
  const ids = new Set<string>();
  for (const block of collectStepBlocks(workflow)) {
    const rawId = block.match(/^\s*(?:-\s+)?["']?id["']?\s*:\s*(.+?)\s*$/m)?.[1];
    const id = rawId ? decodeYamlScalar(rawId) : undefined;
    if (id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) && containsUntrustedPayload(block)) ids.add(id);
  }
  return ids;
};

const stepOutputPattern = (stepId: string) => {
  const escaped = stepId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`steps\\.${escaped}\\.outputs(?:\\.[A-Za-z_][A-Za-z0-9_-]*|\\[['"][^'"]+['"]\\])`, 'i');
};

const envReferencePattern = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}\\}|\\$env:${escaped}\\b|%${escaped}%|env\\.${escaped}\\b)`, 'i');
};

const indirectPointerPattern = (name: string) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\$\\{!${escaped}\\}`, 'i');
};

type EnvTaint = { tainted: Set<string>; indirectPointers: Set<string> };

const extractTaintedEnvVars = (workflow: string, taintedStepIds: Set<string>): EnvTaint => {
  const entries: Array<{ name: string; value: string }> = [];
  const anchors = new Map<string, string>();
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)((?:[A-Za-z_][A-Za-z0-9_]*|'(?:[^']|'')+'|"(?:[^"\\]|\\.)+"))\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const name = decodeYamlScalar(match[2]);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = normalizeAccess(match[3]);
    if (isBlockScalarHeader(value)) {
      const block = collectIndentedValue(lines, index, indent);
      value = normalizeAccess(block.value);
      index = block.endIndex;
    }
    const anchor = value.match(/^&([A-Za-z0-9_-]+)\s+([\s\S]+)$/);
    if (anchor) {
      value = anchor[2];
      anchors.set(anchor[1], value);
    } else {
      const alias = value.match(/^\*([A-Za-z0-9_-]+)$/);
      if (alias && anchors.has(alias[1])) value = anchors.get(alias[1])!;
    }
    entries.push({ name, value });
  }

  const tainted = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, value } of entries) {
      if (tainted.has(name)) continue;
      const isTainted = containsUntrustedPayload(value)
        || [...taintedStepIds].some((id) => stepOutputPattern(id).test(value))
        || [...tainted].some((other) => envReferencePattern(other).test(value));
      if (isTainted) { tainted.add(name); changed = true; }
    }
  }

  const indirectPointers = new Set<string>();
  for (const { name, value } of entries) {
    const pointedAt = decodeYamlScalar(value).replace(/^\$/, '');
    if (tainted.has(pointedAt)) indirectPointers.add(name);
  }
  return { tainted, indirectPointers };
};

const extractRunValues = (workflow: string) => {
  const values: string[] = [];
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s*)?["']?run["']?\s*:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    let value = match[2];
    if (isBlockScalarHeader(value)) {
      const block = collectIndentedValue(lines, index, indent);
      value = block.value;
      index = block.endIndex;
    }
    if (value) values.push(value);
  }
  return values;
};

const assertNoTransitiveUntrustedShell = (workflow: string, source: string) => {
  const taintedStepIds = extractTaintedStepIds(workflow);
  const { tainted, indirectPointers } = extractTaintedEnvVars(workflow, taintedStepIds);
  for (const run of extractRunValues(workflow)) {
    const normalizedRun = normalizeAccess(run);
    expect(containsUntrustedPayload(normalizedRun), `${source}: direct untrusted payload in run`).toBe(false);
    for (const id of taintedStepIds) expect(stepOutputPattern(id).test(normalizedRun), `${source}: tainted output from ${id} reaches run`).toBe(false);
    for (const name of tainted) expect(envReferencePattern(name).test(normalizedRun), `${source}: tainted env ${name} reaches run`).toBe(false);
    for (const pointer of indirectPointers) expect(indirectPointerPattern(pointer).test(normalizedRun), `${source}: ${pointer} indirectly expands a tainted env`).toBe(false);
  }
};

describe('GitHub workflow transitive untrusted shell policy', () => {
  it('recognizes optional-chained context payload text', () => {
    const unsafe = ['steps:', '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    id: capture', '    with:', '      script: return context.payload.comment?.body', '  - run: bash -c "${{ steps.capture.outputs.result }}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'optional-chain.yml')).toThrow();
  });
  it('tracks a tainted step id regardless of mapping-key order', () => {
    const unsafe = ['steps:', '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    with:', '      script: return context.payload.comment.body', '    id: capture', '  - run: bash -c "${{ steps.capture.outputs.result }}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'id-order.yml')).toThrow();
  });
  it('propagates tainted step outputs through env before shell execution', () => {
    const unsafe = ['steps:', '  - id: capture', '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    with:', '      script: return context.payload.comment.body', '  - env:', '      CMD: ${{ steps.capture.outputs.result }}', '    run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'output-env.yml')).toThrow();
  });
  it('propagates taint through YAML scalar aliases', () => {
    const unsafe = ['env:', '  RAW: &payload ${{ github.event.comment.body }}', '  CMD: *payload', 'steps:', '  - run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'yaml-alias.yml')).toThrow();
  });
  it('rejects Bash indirect expansion through a pointer variable', () => {
    const unsafe = ['env:', '  RAW: ${{ github.event.comment.body }}', '  NAME: RAW', 'steps:', '  - run: bash -c "${!NAME}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'indirect-pointer.yml')).toThrow();
  });
  it('propagates tainted step outputs through block-scalar env values', () => {
    const unsafe = ['steps:', '  - id: capture', '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    with:', '      script: return context.payload.comment.body', '  - env:', '      CMD: >-', '        ${{ steps.capture.outputs.result }}', '    run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'block-output-env.yml')).toThrow();
  });
  it('inspects block-scalar run bodies for tainted step outputs', () => {
    const unsafe = ['steps:', '  - uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    id: capture', '    with:', '      script: return context.payload.comment?.body', '  - run: |', '      bash -c "${{ steps.capture.outputs.result }}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'block-run.yml')).toThrow();
  });
  it('propagates taint across environment-variable aliases', () => {
    const unsafe = ['env:', '  RAW: ${{ github.event.comment.body }}', '  CMD: $RAW', 'steps:', '  - run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'env-alias.yml')).toThrow();
  });
  it('taints github-script outputs derived by destructuring untrusted parent payloads', () => {
    const unsafe = ['steps:', '  - id: capture', '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    with:', '      script: |', '        const { body } = context.payload.comment;', '        return body;', '  - run: bash -c "${{ steps.capture.outputs.result }}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'destructure.yml')).toThrow();
  });
  it('decodes quoted environment keys before tracing taint', () => {
    const unsafe = ['env:', '  "CMD": ${{ github.event.comment.body }}', 'steps:', '  - run: bash -c "$CMD"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'quoted-env.yml')).toThrow();
  });
  it('decodes quoted step ids before tracking outputs', () => {
    const unsafe = ['steps:', '  - id: "capture"', '    uses: actions/github-script@0123456789abcdef0123456789abcdef01234567', '    with:', '      script: return context.payload.comment.body', '  - run: bash -c "${{ steps.capture.outputs.result }}"'].join('\n');
    expect(() => assertNoTransitiveUntrustedShell(unsafe, 'quoted-id.yml')).toThrow();
  });
  it('checks every repository workflow for these transitive paths', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const workflowFile of workflowFiles) assertNoTransitiveUntrustedShell(readFileSync(join(workflowsDir, workflowFile), 'utf8'), workflowFile);
  });
});
