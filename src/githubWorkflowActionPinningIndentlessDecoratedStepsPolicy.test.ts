import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowFiles = readdirSync('.github/workflows')
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
const immutableSha = /^[0-9a-f]{40}$/i;

const decodeKey = (raw: string) => {
  const key = raw.trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    try { return JSON.parse(key) as string; } catch { return key.slice(1, -1); }
  }
  if (key.startsWith("'") && key.endsWith("'")) return key.slice(1, -1).replace(/''/g, "'");
  return key;
};

const expectIndentlessDecoratedStepsPinned = (workflow: string, source: string) => {
  const lines = workflow.split('\n');
  let stepsIndent: number | null = null;
  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/\s+#.*$/, '');
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const key = trimmed.match(/^((?:"(?:\\.|[^"])*")|(?:'(?:''|[^'])*')|(?:[A-Za-z_][A-Za-z0-9_-]*))\s*:\s*$/);
    if (key && decodeKey(key[1]) === 'steps') {
      stepsIndent = indent;
      continue;
    }
    const indentlessItem = stepsIndent !== null && indent === stepsIndent && trimmed.startsWith('- ');
    if (stepsIndent !== null && indent <= stepsIndent && !indentlessItem) stepsIndent = null;
    if (stepsIndent === null) continue;
    const decorated = trimmed.match(/^-\s+(?:(?:&[^\s]+|![^\s]*)\s+)+uses\s*:\s*([^\s]+)\s*$/);
    if (!decorated) continue;
    const ref = decorated[1];
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    const at = ref.lastIndexOf('@');
    expect(at, `${source}: missing immutable ref in ${ref}`).toBeGreaterThan(0);
    expect(immutableSha.test(ref.slice(at + 1)), `${source}: mutable action ref ${ref}`).toBe(true);
  }
};

describe('indentless decorated steps pinning policy', () => {
  it('rejects a mutable decorated action in an indentless steps sequence', () => {
    const unsafe = ['jobs:', '  build:', '    steps:', '    - &uses-key uses: actions/checkout@v4'].join('\n');
    expect(() => expectIndentlessDecoratedStepsPinned(unsafe, 'unsafe.yml')).toThrow();
  });

  it('accepts a fully pinned decorated action in an indentless steps sequence', () => {
    const safe = ['jobs:', '  build:', '    steps:', '    - &uses-key uses: actions/checkout@0123456789abcdef0123456789abcdef01234567'].join('\n');
    expectIndentlessDecoratedStepsPinned(safe, 'safe.yml');
  });

  it('enforces the case across checked-in workflows', () => {
    for (const file of workflowFiles) {
      expectIndentlessDecoratedStepsPinned(readFileSync(join('.github/workflows', file), 'utf8'), file);
    }
  });
});