import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();

const normalizeJavaScript = (source: string) =>
  source
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\?\./g, '.');

const isTaintedPayload = (value: string) => {
  const normalized = normalizeJavaScript(value).replace(
    /\[['"]([^'"]+)['"]\]/g,
    '.$1',
  );
  return /\bcontext\.payload\.(?:issue|comment|pull_request|review|discussion)\.(?:body|title|diff_hunk|path)\b/.test(
    normalized,
  );
};

const hasEnvWrappedShellExecution = (source: string) => {
  const normalized = normalizeJavaScript(source);
  const callPattern = /\bexecFile(?:Sync)?\s*\(\s*(['"])([^'"]+)\1\s*,\s*\[([\s\S]*?)\]\s*(?:,|\))/g;

  for (const call of normalized.matchAll(callPattern)) {
    const executable = call[2].replace(/\\/g, '/').split('/').pop()?.toLowerCase();
    if (executable !== 'env') continue;

    const args = Array.from(
      call[3].matchAll(/(?:^|,)\s*(['"])([^'"]*)\1|(?:^|,)\s*([^,]+)/g),
      (match) => (match[2] ?? match[3] ?? '').trim(),
    );
    const shell = args[0]?.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
    if (!['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(shell ?? '')) continue;
    if (args[1] !== '-c') continue;
    if (isTaintedPayload(args.slice(2).join(','))) return true;
  }

  return false;
};

describe('GitHub Script env-wrapper shell policy', () => {
  it('rejects attacker-controlled shell code launched through /usr/bin/env', () => {
    expect(
      hasEnvWrappedShellExecution(
        "execFileSync('/usr/bin/env', ['bash', '-c', context.payload.comment.body])",
      ),
    ).toBe(true);
    expect(
      hasEnvWrappedShellExecution(
        "execFile('/usr/bin/env', ['sh', '-c', context.payload.issue.title])",
      ),
    ).toBe(true);
  });

  it('allows env wrappers when the shell program is repository-owned', () => {
    expect(
      hasEnvWrappedShellExecution(
        "execFileSync('/usr/bin/env', ['bash', '-c', 'npm test'])",
      ),
    ).toBe(false);
    expect(
      hasEnvWrappedShellExecution(
        "execFileSync('/usr/bin/env', ['node', 'script.js', context.payload.comment.body])",
      ),
    ).toBe(false);
  });

  it('enforces the policy across checked-in workflows', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    for (const file of workflowFiles) {
      const workflow = readFileSync(join(workflowsDir, file), 'utf8');
      expect(hasEnvWrappedShellExecution(workflow), file).toBe(false);
    }
  });
});
