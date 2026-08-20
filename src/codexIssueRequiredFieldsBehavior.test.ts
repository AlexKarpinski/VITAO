import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const workflow = readFileSync('.github/workflows/codex-issue-trigger.yml', 'utf8');
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

async function run(body: string | null) {
  const createComment = vi.fn();
  const github = {
    rest: { issues: {
      get: vi.fn().mockResolvedValue({ data: { number: 37, state: 'open', body, labels: [{ name: 'ready-for-codex' }] } }),
      createComment,
      listComments: vi.fn(),
    } },
    paginate: vi.fn().mockResolvedValue([]),
  };
  const context = {
    repo: { owner: 'AlexKarpinski', repo: 'VITAO' }, runId: 123, workflow: 'Trigger Codex from issue',
    payload: { issue: { number: 37 }, comment: { id: 456, user: { login: 'owner' } } },
  };
  const core = { info: vi.fn() };
  const process = { env: { CODEX_WORKER_ENABLED: 'true' } };
  const execute = new AsyncFunction('github', 'context', 'core', 'process', extractScript());
  await execute(github, context, core, process);
  return createComment;
}

describe('Codex required-field admission behavior', () => {
  it('accepts populated headings emitted by the repository Codex issue form', async () => {
    const createComment = await run('### Goal\nImplement one focused change.\n\n### Requirements\nStay scoped.\n\n### Acceptance criteria\n- Tests pass.');
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0][0].body).toContain('@codex implement this issue.');
  });

  it('accepts visible fenced-code content inside a real required section', async () => {
    const createComment = await run('### Goal\nImplement one focused change.\n\n### Acceptance criteria\n```sh\nnpm test -- --run\n```');
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0][0].body).toContain('@codex implement this issue.');
  });

  it.each([
    ['missing body', null],
    ['empty goal', '### Goal\n\n### Acceptance criteria\n- Tests pass.'],
    ['empty acceptance criteria', '### Goal\nImplement one focused change.\n\n### Acceptance criteria\n'],
    ['HTML-comment-only required sections', '### Goal\n<!-- Describe the goal here -->\n\n### Acceptance criteria\n<!-- Add acceptance criteria here -->'],
    ['unclosed HTML comment', '### Goal\n<!-- placeholder\n\n### Acceptance criteria\n- Tests pass.'],
    ['headings inside HTML comments', '<!--\n### Goal\nHidden goal\n-->\n\n<!--\n### Acceptance criteria\n- Hidden criterion\n-->'],
    ['empty fenced blocks', '### Goal\n```\n```\n\n### Acceptance criteria\n~~~\n~~~'],
    ['fenced-code headings', '```md\n### Goal\nExample only.\n### Acceptance criteria\n- Example only.\n```'],
    ['tilde-fenced headings', '~~~md\n### Goal\nExample only.\n### Acceptance criteria\n- Example only.\n~~~'],
    ['short closing fence inside longer fence', '````md\n### Goal\nExample only.\n```\n### Acceptance criteria\n- Example only.\n````'],
  ])('rejects %s before request generation', async (_name, body) => {
    const createComment = await run(body);
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0][0].body).toContain('issue scope is incomplete');
    expect(createComment.mock.calls[0][0].body).not.toContain('@codex implement this issue.');
  });
});
