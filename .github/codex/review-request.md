# Codex review request contract

Use this contract when the Delivery Engine requests an automated Codex review for a pull request.

## Preconditions

- Required CI is green for the exact current PR head SHA.
- The PR is non-draft and ready for review.
- No trusted Delivery Engine review request has already been issued for the same exact head SHA.

## Request format

Post exactly one review request for the current head SHA and include the hidden marker below in the same comment:

```text
@codex review

<!-- codex-review-requested:<full-head-sha> -->
```

Replace `<full-head-sha>` with the current 40-character lowercase hexadecimal PR head SHA. Never reuse a marker from an older revision.

## Revision and author safety

- Treat the full SHA in the hidden marker as the identity of the requested review.
- A duplicate marker counts only when the same comment contains both `@codex review` and the exact current-SHA marker and the comment author is a configured trusted Delivery Engine identity.
- Never suppress a real review request because an untrusted PR participant copied the marker or because a trusted comment contains only the marker without `@codex review`.
- Re-fetch the PR head and required CI immediately before issuing the request; abort if the head changed or exact-SHA CI is no longer green.
- A remediation commit changes the head SHA and invalidates older review readiness for merge purposes.
- Request a new review only after required CI succeeds for the new exact head SHA.
- Reviews for older SHAs must never authorize merging a newer revision.

This contract does not grant merge permission. Final merge gating remains with the Delivery Engine.
