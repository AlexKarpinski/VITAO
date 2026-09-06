import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeExpressionAccess = (value: string) =>
  value
    .replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1')
    .replace(/\?\./g, '.');

const untrustedGithubScriptReturn = (script: string) => {
  const normalized = normalizeExpressionAccess(script);
  return /\breturn\s+[^;\n]*(?:context\.payload\.(?:comment|issue|pull_request|review|review_comment|discussion)\.(?:body|title)|github\.event\.(?:comment|issue|pull_request|review|review_comment|discussion)\.(?:body|title))/.test(
    normalized,
  );
};

const splitTopLevel = (source: string, delimiter: ',' | ':') => {
  const parts: string[] = [];
  let start = 0;
  let braces = 0;
  let brackets = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote === "'") {
      if (char === "'" && source[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === delimiter && braces === 0 && brackets === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
      if (delimiter === ':') break;
    }
  }

  parts.push(source.slice(start));
  return parts;
};

const decodeScalar = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
};

const parseFlowMapping = (source: string) => {
  const trimmed = source.trim();
  const body = trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed.slice(1, -1) : trimmed;
  const values = new Map<string, string>();
  for (const entry of splitTopLevel(body, ',')) {
    const pair = splitTopLevel(entry, ':');
    if (pair.length < 2) continue;
    const key = decodeScalar(pair[0]);
    values.set(key, pair.slice(1).join(':').trim());
  }
  return values;
};

const collectFlowStepMappings = (workflow: string) => {
  const steps: string[] = [];
  let quote: '"' | "'" | null = null;
  let depth = 0;
  let start = -1;

  for (let index = 0; index < workflow.length; index += 1) {
    const char = workflow[index];
    if (quote === "'") {
      if (char === "'" && workflow[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = workflow.slice(start, index + 1);
        const mapping = parseFlowMapping(candidate);
        if (mapping.has('run') || mapping.has('uses') || mapping.has('id')) steps.push(candidate);
        start = -1;
      }
    }
  }
  return steps;
};

const expectNoTaintedFlowStepOutput = (workflow: string, source: string) => {
  const taintedStepIds = new Set<string>();
  const flowSteps = collectFlowStepMappings(workflow);

  for (const step of flowSteps) {
    const mapping = parseFlowMapping(step);
    const id = decodeScalar(mapping.get('id') ?? '');
    const uses = decodeScalar(mapping.get('uses') ?? '');
    const withValue = mapping.get('with');
    if (!id || !/^actions\/github-script@/i.test(uses) || !withValue) continue;

    const withMapping = parseFlowMapping(withValue);
    const script = decodeScalar(withMapping.get('script') ?? '');
    if (untrustedGithubScriptReturn(script)) taintedStepIds.add(id);
  }

  for (const step of flowSteps) {
    const run = decodeScalar(parseFlowMapping(step).get('run') ?? '');
    for (const id of taintedStepIds) {
      const normalized = normalizeExpressionAccess(run);
      expect(normalized, `${source}: ${run}`).not.toMatch(
        new RegExp(`steps\\.${id.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\.outputs\\.[A-Za-z_][A-Za-z0-9_-]*`),
      );
    }
  }
};

describe('GitHub workflow flow-style step-output trust policy', () => {
  it('rejects tainted flow-style step outputs in checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      expectNoTaintedFlowStepOutput(readFileSync(join(workflowsDir, file), 'utf8'), file);
    }
  });

  it('rejects a flow-style GitHub Script result reaching a shell run', () => {
    expect(() =>
      expectNoTaintedFlowStepOutput(
        `steps: [{ id: capture, uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { script: "return context.payload.comment.body" } }, { run: "bash -c '\${{ steps.capture.outputs.result }}'" }]`,
        'unsafe.yml',
      ),
    ).toThrow();
  });

  it('allows a constant result even when the flow-style step logs untrusted text', () => {
    expect(() =>
      expectNoTaintedFlowStepOutput(
        `steps: [{ id: capture, uses: actions/github-script@0123456789abcdef0123456789abcdef01234567, with: { script: "core.info(context.payload.comment.body); return 'echo safe'" } }, { run: "bash -c '\${{ steps.capture.outputs.result }}'" }]`,
        'safe.yml',
      ),
    ).not.toThrow();
  });
});
