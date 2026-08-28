import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = '.github/workflows';
const workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name)).sort();

const assertNoEventPathGithubEnvShellFlow = (workflow: string) => {
  const lines = workflow.split('\n');
  const taintedEnv = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    const write = line.match(/(?:echo|printf)\s+["']?([A-Za-z_][A-Za-z0-9_]*)=.*GITHUB_EVENT_PATH.*(?:>>|>)\s*["']?\$?\{?GITHUB_ENV\}?/i);
    if (write && /(?:comment\.body|issue\.body|pull_request\.body|review\.body|discussion\.body)/i.test(line)) taintedEnv.add(write[1]);
    const run = line.match(/^(?:-\s*)?run\s*:\s*(.*)$/);
    if (!run) continue;
    for (const name of taintedEnv) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ref = new RegExp(`(?:\\$${escaped}\\b|\\$\\{${escaped}(?:[:}])|%${escaped}%|\\$env:${escaped}\\b|env\\.${escaped}\\b)`, 'i');
      if (ref.test(run[1]) && /(?:bash\s+-c|sh\s+-c|eval|invoke-expression|call\s+%)/i.test(run[1])) {
        throw new Error(`tainted ${name} from GITHUB_EVENT_PATH reaches shell execution`);
      }
    }
  }
};

describe('GITHUB_EVENT_PATH to GITHUB_ENV shell boundary', () => {
  it('rejects event-body data persisted to GITHUB_ENV then executed', () => {
    const workflow = `steps:\n  - run: echo "CMD=$(jq -r '.comment.body' "$GITHUB_EVENT_PATH")" >> "$GITHUB_ENV"\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).toThrow();
  });

  it('allows constant persisted values', () => {
    const workflow = `steps:\n  - run: echo "CMD=echo-safe" >> "$GITHUB_ENV"\n  - run: bash -c "$CMD"`;
    expect(() => assertNoEventPathGithubEnvShellFlow(workflow)).not.toThrow();
  });

  it('enforces every checked-in workflow', () => {
    for (const file of workflowFiles) assertNoEventPathGithubEnvShellFlow(readFileSync(join(workflowsDir, file), 'utf8'));
  });
});
