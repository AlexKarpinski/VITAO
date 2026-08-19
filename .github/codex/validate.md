# VITAO validation contract

Run validation from the repository root on the exact branch revision being reported.

## Required commands

```bash
npm ci
npm test -- --run
npm run build
```

## Command meaning

- `npm ci` verifies lockfile-consistent dependency installation.
- `npm test -- --run` executes the Vitest suite once in CI mode.
- `npm run build` runs TypeScript project compilation and the Vite production build.

## Applicability of other checks

- Format: there is currently no repository format or format-check script, so formatting is not a separately executable required check.
- Lint: there is currently no repository lint script, so lint is not a separately executable required check.
- TypeScript type checking: it is required and is executed by `npm run build` through `tsc -b`; do not report a separate typecheck command unless the repository adds one.
- Playwright/live-site checks: no Playwright command is currently configured in `package.json`; run one only when the repository adds and documents an approved command and the issue makes it applicable.
- Security/dependency checks: no separate repository-required security or dependency audit command is currently configured; do not invent one.

Do not report a non-configured check as passed or failed. If an issue explicitly requires a check that is not configured, report it as unavailable with the exact reason and do not claim the issue's validation is complete.

## Failure behavior

- Stop and report the exact failing command.
- Include the concise error summary and affected test/file when available.
- Do not claim later commands passed if they were not run.
- Preserve successful commits and leave the branch recoverable.
- Never expose environment secrets or dump excessive raw logs into GitHub comments.

## Exact-SHA evidence

Record:

- full head SHA;
- every required command and result;
- any unavailable or intentionally skipped non-required check with reason;
- workflow run URL/number when validation runs in GitHub Actions;
- whether the result applies to the current head SHA.

A green result for an older SHA is never valid evidence for a newer revision.
