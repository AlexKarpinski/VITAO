import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableRef = /^[^@\s]+@[0-9a-f]{40}$/;
const indentOf = (line: string) => line.match(/^\s*/)?.[0].length ?? 0;

const squareDelta = (line: string) => {
  let quote: '"' | "'" | null = null;
  let delta = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        let backslashes = 0;
        for (let previous = index - 1; previous >= 0 && line[previous] === '\\'; previous -= 1) backslashes += 1;
        if (quote === "'" || backslashes % 2 === 0) quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#') break;
    if (char === '[') delta += 1;
    else if (char === ']') delta -= 1;
  }
  return delta;
};

const collectUses = (line: string) => {
  const refs: string[] = [];
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote && line[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#') break;
    const match = line.slice(index).match(/^(?:\{|,|\[)?\s*uses\s*:\s*([^,}\]]+)/);
    if (match) {
      refs.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
      index += match[0].length - 1;
    }
  }
  return refs;
};

const extractDeferredExplicitStepRefs = (workflow: string) => {
  const refs: string[] = [];
  const lines = workflow.split('\n');
  let explicitKeyIndent: number | null = null;
  let pendingValueIndent: number | null = null;
  let flowDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = indentOf(line);

    if (flowDepth > 0) {
      refs.push(...collectUses(line));
      flowDepth += squareDelta(line);
      if (flowDepth <= 0) flowDepth = 0;
      continue;
    }

    if (pendingValueIndent !== null) {
      if (!trimmed) continue;
      if (indent <= pendingValueIndent) { pendingValueIndent = null; }
      else {
        const opening = line.indexOf('[');
        if (opening >= 0) {
          const remainder = line.slice(opening + 1);
          refs.push(...collectUses(remainder));
          flowDepth = 1 + squareDelta(remainder);
        }
        pendingValueIndent = null;
        continue;
      }
    }

    if (/^\?\s*(?:steps|['"]steps['"])\s*$/.test(trimmed)) {
      explicitKeyIndent = indent;
      continue;
    }

    if (explicitKeyIndent !== null) {
      const value = trimmed.match(/^:\s*(.*)$/);
      if (!value || indent !== explicitKeyIndent) {
        if (trimmed) explicitKeyIndent = null;
        continue;
      }
      if (!value[1].trim()) {
        pendingValueIndent = indent;
      } else {
        const opening = value[1].indexOf('[');
        if (opening >= 0) {
          const remainder = value[1].slice(opening + 1);
          refs.push(...collectUses(remainder));
          flowDepth = 1 + squareDelta(remainder);
        }
      }
      explicitKeyIndent = null;
    }
  }
  return refs;
};

const expectPinned = (refs: string[]) => {
  for (const ref of refs) expect(ref).toMatch(immutableRef);
};

describe('GitHub workflow deferred explicit steps action-pinning policy', () => {
  it('scans every checked-in workflow', () => {
    for (const name of workflowFiles) expectPinned(extractDeferredExplicitStepRefs(readFileSync(join(workflowsDir, name), 'utf8')));
  });

  it('rejects mutable refs when an explicit steps value is deferred after a bare colon', () => {
    const unsafe = ['jobs:', '  build:', '    ? steps', '    :', '      [', '        { uses: actions/checkout@v4 },', '      ]'].join('\n');
    expect(() => expectPinned(extractDeferredExplicitStepRefs(unsafe))).toThrow();
  });

  it('allows immutable refs for the same YAML structure', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const safe = ['jobs:', '  build:', '    ? "steps"', '    :', '      [', `        { uses: actions/checkout@${sha} },`, '      ]'].join('\n');
    expectPinned(extractDeferredExplicitStepRefs(safe));
  });
});
