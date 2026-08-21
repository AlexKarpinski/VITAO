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
  const process = {
    env: {
      CODEX_WORKER_ENABLED: 'true',
      CODEX_PILOT_SUCCEEDED: 'true',
    },
  };
  const execute = new AsyncFunction('github', 'context', 'core', 'process', extractScript());
  await execute(github, context, core, process);
  return createComment;
}

async function expectAdmitted(body: string) {
  const createComment = await run(body);
  expect(createComment).toHaveBeenCalledOnce();
  expect(createComment.mock.calls[0][0].body).toContain('@codex implement this issue.');
}

describe('Codex required-field admission behavior', () => {
  it('accepts populated headings emitted by the repository Codex issue form', async () => {
    await expectAdmitted('### Goal\nImplement one focused change.\n\n### Requirements\nStay scoped.\n\n### Acceptance criteria\n- Tests pass.');
  });

  it('accepts valid ATX headings with optional closing hashes', async () => {
    await expectAdmitted('### Goal ###\nImplement one focused change.\n\n### Acceptance criteria ###\n- Tests pass.');
  });

  it('accepts valid ATX headings indented by up to three spaces', async () => {
    await expectAdmitted('   ### Goal\nImplement one focused change.\n\n  ### Acceptance criteria\n- Tests pass.');
  });

  it('accepts visible fenced-code content inside a real required section', async () => {
    await expectAdmitted('### Goal\nImplement one focused change.\n\n### Acceptance criteria\n```sh\nnpm test -- --run\n```');
  });

  it('accepts link-reference syntax when it is literal fenced-code content', async () => {
    await expectAdmitted('### Goal\n```md\n[docs]: /new-url\n```\n\n### Acceptance criteria\n- Preserve the rendered example.');
  });

  it('preserves literal HTML-comment openers inside inline code', async () => {
    await expectAdmitted('### Goal\nDocument the `<!--` token.\n\n### Acceptance criteria\n- Keep the token visible.');
  });

  it('preserves literal HTML-comment openers inside multiline code spans', async () => {
    await expectAdmitted('### Goal\nDocument the `<!--\ntoken` safely.\n\n### Acceptance criteria\n- Keep the token visible.');
  });

  it('preserves literal shorter fence markers inside longer fenced examples', async () => {
    await expectAdmitted('### Goal\n````md\n```\n````\n\n### Acceptance criteria\n- Preserve the literal marker.');
  });

  it.each([
    ['missing body', null],
    ['empty goal', '### Goal\n\n### Acceptance criteria\n- Tests pass.'],
    ['empty acceptance criteria', '### Goal\nImplement one focused change.\n\n### Acceptance criteria\n'],
    ['tab-indented pseudo-headings', '\t### Goal\nVisible text.\n\n\t### Acceptance criteria\n- Looks populated but renders as code.'],
    ['HTML-comment-only required sections', '### Goal\n<!-- Describe the goal here -->\n\n### Acceptance criteria\n<!-- Add acceptance criteria here -->'],
    ['HTML comment after a fenced block', '### Goal\n```text\nvisible goal\n```\n\n### Acceptance criteria\n<!-- hidden -->'],
    ['unmatched inline code before hidden acceptance criteria', '### Goal\nDocument the ` token.\n\n### Acceptance criteria\n<!-- hidden -->'],
    ['unclosed HTML comment', '### Goal\n<!-- placeholder\n\n### Acceptance criteria\n- Tests pass.'],
    ['headings inside HTML comments', '<!--\n### Goal\nHidden goal\n-->\n\n<!--\n### Acceptance criteria\n- Hidden criterion\n-->'],
    ['empty fenced blocks', '### Goal\n```\n```\n\n### Acceptance criteria\n~~~\n~~~'],
    ['fenced-code headings', '```md\n### Goal\nExample only.\n### Acceptance criteria\n- Example only.\n```'],
    ['tilde-fenced headings', '~~~md\n### Goal\nExample only.\n### Acceptance criteria\n- Example only.\n~~~'],
    ['short closing fence inside longer fence', '````md\n### Goal\nExample only.\n```\n### Acceptance criteria\n- Example only.\n````'],
    ['link-reference-only required sections', '### Goal\n[goal]: https://example.com\n\n### Acceptance criteria\n[criteria]: https://example.com/criteria'],
    ['multiline link-reference-only required sections', '### Goal\n[goal]: /goal\n  "Goal title"\n\n### Acceptance criteria\n[criteria]: /criteria\n  "Criteria title"'],
  ])('rejects %s before request generation', async (_name, body) => {
    const createComment = await run(body);
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0][0].body).toContain('issue scope is incomplete');
    expect(createComment.mock.calls[0][0].body).not.toContain('@codex implement this issue.');
  });
});
