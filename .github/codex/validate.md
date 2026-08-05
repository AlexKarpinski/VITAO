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

There is currently no separate repository lint script. Do not report lint as passed, failed, or skipped unless the repository adds and documents one.

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
