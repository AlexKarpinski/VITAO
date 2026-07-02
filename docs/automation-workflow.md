# VITAO Automation Workflow

This document describes the recommended semi-automated workflow between ChatGPT, Codex, and GitHub.

## Goal

Make the development loop repeatable:

1. Create a focused task.
2. Let Codex implement it.
3. Let CI verify the build.
4. Review the PR.
5. Merge only after the checklist is clean.

## Current Automation Setup

The repository includes:

- `AGENTS.md` — persistent instructions for Codex and other coding agents
- `.github/ISSUE_TEMPLATE/codex-task.yml` — structured GitHub Issue template for Codex tasks
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist for implementation and design review
- `.github/workflows/ci.yml` — build check for pull requests and pushes to `main`
- `.github/workflows/deploy-pages.yml` — GitHub Pages deployment after the app exists
- `docs/codex-tasks.md` — ordered task backlog for Codex

## Recommended Loop

### 1. Create a GitHub Issue

Use the `Codex Task` issue template.

Keep the task small enough for one PR.

Good task examples:

- Initialize Vite + React + TypeScript app
- Implement product catalog page
- Improve product card design
- Add product detail route
- Add custom order page

Bad task examples:

- Build the whole shop
- Make everything beautiful
- Add ecommerce
- Finish the site

## 2. Paste the Issue into Codex

Use the generated prompt from the issue template.

Codex should:

- read repository context
- implement the focused task
- run build
- create a pull request

## 3. Let GitHub Actions Check the PR

The CI workflow runs on pull requests.

Expected check:

- install dependencies
- run build

The workflow is safe before app initialization: if `package.json` does not exist yet, it skips build.

## 4. Review the PR

Review in this order:

1. Build result
2. Scope control
3. Code structure
4. Visual/design quality
5. Mobile responsiveness
6. Docs updates

## 5. Ask ChatGPT for Review

Send ChatGPT:

- PR number, or
- PR link, or
- diff/summary from Codex

Suggested message:

```text
Review PR #X in AlexKarpinski/VITAO.
Check architecture, design direction, scope control, and whether it is safe to merge.
```

## 6. Follow-Up Fixes

If changes are needed, ask Codex for a narrow follow-up:

```text
Apply the review feedback from the PR comments.
Keep the scope limited to the existing PR.
Run build again and summarize what changed.
```

## 7. Merge

Merge only when:

- CI passes
- scope is controlled
- design direction still matches VITAO
- no unnecessary backend/payment/cart/auth was added

## Automation Level

This workflow is semi-automated.

What is automated:

- task structure
- PR checklist
- build validation
- deploy workflow
- repeatable Codex prompt context

What remains manual:

- starting a Codex task
- approving risky changes
- design taste decisions
- final merge decision
