import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;

const yamlDoubleQuotedToJson = (value: string) => value
  .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) => `\\u00${hex}`);

const decodeYamlKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(yamlDoubleQuotedToJson(key)) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const stripQuoted = (raw: string) => {
  const value = raw.trim().replace(/[,}\]]\s*$/, '').trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
};

const structuralUses = (source: string) => {
  const refs: string[] = [];
  const lines = source.split('\n');
  let explicitStepsIndent: number | null = null;
  let blockStepsIndent: number | null = null;
  let pendingBareStepIndent: number | null = null;

  const collectFlowMapping = (text: string) => {
    const normalized = text.trim();
    if (normalized.startsWith('{') && normalized.endsWith('}')) {
      collectFlowMapping(normalized.slice(1, -1));
      return;
    }

    let quote: '"' | "'" | null = null;
    let curly = 0;
    let square = 0;
    let start = 0;
    const entries: string[] = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (quote) {
        if (char === quote && (quote === "'" || normalized[index - 1] !== '\\')) quote = null;
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '{') curly += 1;
      else if (char === '}') curly -= 1;
      else if (char === '[') square += 1;
      else if (char === ']') square -= 1;
      else if (char === ',' && curly === 0 && square === 0) {
        entries.push(normalized.slice(start, index));
        start = index + 1;
      }
    }
    entries.push(normalized.slice(start));
    for (const entry of entries) {
      const candidate = entry.trim();
      if (candidate.startsWith('{') && candidate.endsWith('}')) {
        collectFlowMapping(candidate);
        continue;
      }
      const mapping = candidate.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*(.+?)\s*$/);
      if (mapping && decodeYamlKey(mapping[1]) === 'uses') refs.push(stripQuoted(mapping[2]));
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const explicitKey = trimmed.match(/^\?\s*((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*$/);
    if (explicitKey && decodeYamlKey(explicitKey[1]) === 'steps') {
      explicitStepsIndent = indent;
      continue;
    }
    if (explicitStepsIndent !== null) {
      const explicitValue = trimmed.match(/^:\s*(.*)$/);
      if (explicitValue) {
        let value = explicitValue[1].trim();
        if (value.startsWith('[') && !value.includes(']')) {
          const parts = [value];
          for (let child = index + 1; child < lines.length; child += 1) {
            parts.push(lines[child].trim());
            index = child;
            if (lines[child].includes(']')) break;
          }
          value = parts.join(' ');
        }
        if (value.startsWith('[')) {
          const closing = value.lastIndexOf(']');
          collectFlowMapping(value.slice(1, closing >= 0 ? closing : undefined));
        }
        explicitStepsIndent = null;
        continue;
      }
      if (indent <= explicitStepsIndent) explicitStepsIndent = null;
    }

    const section = trimmed.match(/^((?:"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    if (section && decodeYamlKey(section[1]) === 'steps') {
      blockStepsIndent = indent;
      pendingBareStepIndent = null;
      continue;
    }
    if (blockStepsIndent !== null && indent <= blockStepsIndent) {
      blockStepsIndent = null;
      pendingBareStepIndent = null;
    }
    if (blockStepsIndent !== null && /^-\s*$/.test(trimmed)) {
      pendingBareStepIndent = indent;
      continue;
    }
    if (pendingBareStepIndent !== null && indent > pendingBareStepIndent && trimmed.startsWith('{')) {
      collectFlowMapping(trimmed);
      pendingBareStepIndent = null;
    }
  }
  return refs;
};

const expectPinned = (workflow: string) => {
  for (const ref of structuralUses(workflow)) expect(ref).toMatch(immutableRef);
};

describe('remaining structural action pinning P1 policy', () => {
  it('enforces the structural cases across checked-in workflows', () => {
    for (const name of workflowFiles) expectPinned(readFileSync(join(workflowsDir, name), 'utf8'));
  });

  it('enforces multiline explicit-key steps sequences', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expectPinned(`jobs:\n  demo:\n    ? steps\n    : [\n        { uses: actions/checkout@${sha} }\n      ]`);
    expect(() => expectPinned('jobs:\n  demo:\n    ? steps\n    : [\n        { uses: actions/checkout@v4 }\n      ]')).toThrow();
  });

  it('decodes escaped uses keys after bare sequence markers', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    expectPinned(`jobs:\n  demo:\n    steps:\n      -\n        { "\\u0075ses": actions/checkout@${sha} }`);
    expect(() => expectPinned('jobs:\n  demo:\n    steps:\n      -\n        { "\\u0075ses": actions/checkout@v4 }')).toThrow();
  });

  it('ignores uses-like text inside quoted flow scalars', () => {
    const workflow = 'jobs:\n  demo:\n    steps:\n      - { run: "echo ok, uses: actions/checkout@v4" }';
    expect(structuralUses(workflow)).toEqual([]);
    expectPinned(workflow);
  });
});
