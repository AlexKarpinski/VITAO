import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-ci-fix-trigger.yml', 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<void>;

function extractScript(): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'script: |');
  if (start < 0) throw new Error('Missing github-script body');
  const baseIndent = lines[start].length - lines[start].trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const lineIndent = line.length - line.trimStart().length;
    if (line.trim() && lineIndent <= baseIndent) break;
    body.push(line.slice(baseIndent + 2));
  }
  return body.join('\n');
}

type PullRequest = {
  state: 'open' | 'closed';
  head: { sha: string };
  labels: Array<{ name: string }>;
};

async function runScript(options: {
  prs?: Array<{ number: number }>;
  pullRequests?: PullRequest[];
  comments?: Array<{ user?: { login?: string; type?: string }; body?: string }>;
}) {
  const workflowRun = {
    id: 123,
    html_url: 'https://github.com/AlexKarpinski/VITAO/actions/runs/123',
    head_sha: 'expected-sha',
    pull_requests: options.prs ?? [{ number: 52 }],
  };
  const pulls = options.pullRequests ?? [
    { state: 'open', head: { sha: 'expected-sha' }, labels: [{ name: 'codex-auto-fix' }] },
    { state: 'open', head: { sha: 'expected-sha' }, labels: [{ name: 'codex-auto-fix' }] },
  ];
  const createComment = vi.fn();
  const github = {
    rest: {
      pulls: { get: vi.fn().mockImplementation(() => Promise.resolve({ data: pulls.shift() })) },
      issues: { listComments: vi.fn(), createComment },
    },
    paginate: vi.fn().mockResolvedValue(options.comments ?? []),
  };
  const context = {
    repo: { owner: 'AlexKarpinski', repo: 'VITAO' },
    payload: { workflow_run: workflowRun },
  };
  const core = { info: vi.fn() };
  const execute = new AsyncFunction('github', 'context', 'core', extractScript());
  await execute(github, context, core);
  return { createComment, github };
}

describe('Codex CI-fix trigger policy', () => {
  it('runs only after failed CI and serializes trigger jobs per PR', () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'failure'");
    expect(workflow).toContain('group: codex-ci-fix-${{ github.event.workflow_run.pull_requests[0].number || github.event.workflow_run.id }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('requires exactly one associated pull request', async () => {
    expect((await runScript({ prs: [] })).createComment).not.toHaveBeenCalled();
    expect((await runScript({ prs: [{ number: 1 }, { number: 2 }] })).createComment).not.toHaveBeenCalled();
  });

  it('rejects closed, stale, and non-opted-in pull requests', async () => {
    const closed: PullRequest = { state: 'closed', head: { sha: 'expected-sha' }, labels: [{ name: 'codex-auto-fix' }] };
    const stale: PullRequest = { state: 'open', head: { sha: 'new-sha' }, labels: [{ name: 'codex-auto-fix' }] };
    const unlabelled: PullRequest = { state: 'open', head: { sha: 'expected-sha' }, labels: [] };
    expect((await runScript({ pullRequests: [closed] })).createComment).not.toHaveBeenCalled();
    expect((await runScript({ pullRequests: [stale] })).createComment).not.toHaveBeenCalled();
    expect((await runScript({ pullRequests: [unlabelled] })).createComment).not.toHaveBeenCalled();
  });

  it('trusts only the GitHub Actions bot duplicate marker', async () => {
    const marker = '<!-- codex-ci-fix-requested:52 -->\n@codex fix the CI failures in this PR.';
    const spoofed = await runScript({ comments: [{ user: { login: 'attacker', type: 'User' }, body: marker }] });
    expect(spoofed.createComment).toHaveBeenCalledOnce();
    const trusted = await runScript({ comments: [{ user: { login: 'github-actions[bot]', type: 'Bot' }, body: marker }] });
    expect(trusted.createComment).not.toHaveBeenCalled();
  });

  it('revalidates eligibility after comment pagination', async () => {
    const eligible: PullRequest = { state: 'open', head: { sha: 'expected-sha' }, labels: [{ name: 'codex-auto-fix' }] };
    const advanced: PullRequest = { state: 'open', head: { sha: 'new-sha' }, labels: [{ name: 'codex-auto-fix' }] };
    const result = await runScript({ pullRequests: [eligible, advanced] });
    expect(result.github.rest.pulls.get).toHaveBeenCalledTimes(2);
    expect(result.createComment).not.toHaveBeenCalled();
  });

  it('posts one exact-run request for an eligible pull request', async () => {
    const result = await runScript({});
    expect(result.createComment).toHaveBeenCalledOnce();
    const body = result.createComment.mock.calls[0][0].body as string;
    expect(body).toContain('Failed workflow run 123');
    expect(body).toContain('Failed head SHA: expected-sha');
    expect(body).toContain('single automatic remediation request permitted for this PR');
  });
});
