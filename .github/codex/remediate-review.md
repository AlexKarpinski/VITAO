# VITAO Codex review-remediation prompt

You are remediating actionable review feedback on one existing VITAO pull request.

## Revision safety

- Resolve the current PR head SHA before changing anything.
- Associate every finding with the SHA reviewed by the reviewer.
- Do not treat approval or review for an older SHA as valid for a newer revision.
- After any file change, push a new SHA, rerun required validation, and require a new review.
- Request at most one Codex review per exact SHA.
- Every Codex review request must include the hidden marker `<!-- codex-review-requested:<full-head-sha> -->` using the full exact PR head SHA. Treat a request without that marker, with a short SHA, or with a marker for a different revision as invalid delivery evidence.

## Finding classification

Classify each finding as:

- `BLOCKER`: credential/security/privacy exposure, proven data loss, broken deployment, or broken primary user flow.
- `MAJOR`: direct acceptance-criteria failure, meaningful functional regression, accessibility barrier, or incorrect localization behavior.
- `MINOR`: low-risk edge case, maintainability, test clarity, styling, copy, or non-blocking accessibility improvement.
- `QUESTION`: insufficient evidence or conflicting expected behavior.
- `NON_ACTIONABLE`: outdated, duplicate, incorrect, preference-only, or outside approved scope.

`BLOCKER` and `MAJOR` always block merge. A `MINOR` blocks only when it directly violates approved acceptance criteria, carries a formal active `REQUEST_CHANGES`, or demonstrates security/privacy exposure, proven data loss, or a broken primary flow.

## Safe automatic remediation

A finding may be fixed automatically only when:

- expected behavior is unambiguous;
- the change is inside the approved issue/PR scope;
- required source files and tests are available;
- no owner decision, production secret, binary asset, product fact, legal claim, or real-world evidence must be invented;
- the fix does not introduce unrelated architecture or dependencies.

Suitable examples include focused React/TypeScript logic, route/link fixes, PL/EN mapping, accessibility semantics, metadata/config corrections, focused tests, and current-PR CI failures.

## Escalate instead of changing

Escalate with a precise reason when a finding requires:

- contact details, provider credentials, owner access, pricing inputs, physical measurements, production data, or user feedback;
- large cross-cutting refactoring;
- unapproved backend/database/auth/cart/checkout/payment/account/admin scope;
- unavailable verification or unsafe full-file replacement.

## Cycle control

- Group related fixes into the smallest coherent change.
- Run the validation contract after each remediation revision.
- Stop after three automated remediation cycles for one PR.
- After the third cycle, new non-blocking `MINOR` findings become follow-up candidates instead of extending the PR.
- Security/privacy exposure, proven data loss, broken primary flow, direct acceptance-criteria failures, active `REQUEST_CHANGES`, `BLOCKER`, and `MAJOR` findings remain blocking regardless of cycle count.
- If the third automated remediation cycle does not leave the PR merge-ready, stop automatic mutation and emit one consolidated unresolved-findings report instead of starting a fourth automatic cycle.
- The consolidated report must identify the exact current PR head SHA, each unresolved blocking finding and its source/reviewed SHA, the latest verification state, any follow-up candidates deferred after the cap, and the precise owner/developer/tooling action required next.
- Do not claim an unresolved finding is cleared, deferred, or verified unless GitHub evidence for the current head supports that state.

## Response contract

For every handled finding, emit one remediation decision record that conforms to `.github/codex/remediation-record.schema.json`.

Populate the schema from current evidence only:

- `source` identifies the review/comment that produced the finding.
- `reviewedSha` is the exact SHA actually reviewed.
- `severity`, `target`, and `evidence` capture classification and concrete proof.
- `decision` records `fix`, `challenge`, `defer`, or `escalate` plus the reason.
- `changedFiles` lists only files changed for this finding.
- `verification` records the exact verified SHA and every command actually run under `.github/codex/validate.md`; do not report skipped or unrun commands as passed.
- `threadResolution` records whether the review thread can now be resolved and why.
- `freshReviewRequired` is `true` after any remediation commit changes the PR head.
- `automation` records whether the worker is allowed to apply the decision automatically under this prompt.
- `result` records the resulting commit SHA for a fixed finding or the concrete escalation/follow-up outcome required by the schema.

Do not invent placeholder values to satisfy the schema. If required evidence is unavailable, use an escalation decision rather than claiming a successful fix or verification.
Never include secrets, credentials, tokens, environment values, or unnecessary raw logs in remediation records, PR comments, or review replies.

Never merge. The Delivery Engine owns final merge gating.
