# Contact channel activation checklist

Status: **owner decision required**

This checklist records the minimum evidence required before VITAO presents a visitor-facing inquiry destination as active. It supports Issues #28, #30, and the preconditions for Issue #22.

## Current confirmed facts

- `hello@vitao.studio` is unverified and must not be displayed as an active address or clickable `mailto:` link.
- VITAO serves buyers in `Gdańsk / Trójmiasto, Polska` and delivers across Poland.
- The usual response target is within 1–2 business days.
- Buyer-facing contact and request content must follow the selected PL/EN language without mixed-language states.

## Owner decision record

Complete every required field before implementation starts.

| Field | Required decision or evidence |
| --- | --- |
| Primary destination | Exact verified address, managed form endpoint, or other owned channel |
| Ownership evidence | Who controls the destination and how access was verified |
| Visitor-facing label (PL) | Polish wording shown beside the channel |
| Visitor-facing label (EN) | English equivalent |
| Alternative channel | Verified fallback channel, or an explicit decision that none is available yet |
| Expected response time | Confirm or revise the current 1–2 business day commitment |
| Data handling | Where inquiries are stored, who can access them, and retention/deletion settings |
| Abuse controls | Spam protection, rate limiting, origin restrictions, or provider equivalent |
| Failure behavior | Exact fallback when automatic submission or copying fails |
| Activation approver | Owner who confirms production activation |

## Verification before activation

- Verify the destination by sending a non-production test inquiry and confirming owner-side receipt.
- Confirm the displayed PL and EN labels refer to the same real channel.
- Confirm no inactive placeholder, invented social channel, or unverified `mailto:` remains visible.
- Confirm failed submission or copy actions preserve entered form data.
- Confirm privacy/order information matches the selected provider and actual retention/deletion settings.
- Verify mobile and desktop request flow on the deployed GitHub Pages site.
- Verify console and network behavior for the final deployed commit.
- Record exact-SHA CI and review evidence for the implementation PR.

## Activation gate

The contact channel is **not production-ready** until:

1. all required owner-decision fields above are completed;
2. the destination is verified end to end;
3. PL/EN buyer-facing copy is implemented without mixed-language states;
4. privacy, security, spam, and retention controls are configured and documented;
5. the existing copy/manual fallback remains usable;
6. final exact-SHA CI is green and review gates pass.

## Explicitly out of scope

This decision does not justify authentication, customer accounts, cart, checkout, payments, a custom database, or a custom admin panel. Prefer the smallest managed solution that satisfies the activation gate.
