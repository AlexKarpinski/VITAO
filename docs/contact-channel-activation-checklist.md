# Contact channel activation checklist

Status: **owner decision required**

This checklist records the minimum evidence required before VITAO presents a visitor-facing inquiry destination as active. It supports Issues #28, #30, and the preconditions for Issue #22.

## Current confirmed facts

- `hello@vitao.studio` is unverified and must not be displayed as an active address or clickable `mailto:` link.
- VITAO serves buyers in `Gdańsk / Trójmiasto, Polska` and delivers across Poland.
- The usual response target is within 1–2 business days.
- Buyer-facing contact and request content must default to Polish and follow the selected PL/EN language without mixed-language states.

## Owner decision record

Complete every required field before implementation starts.

| Field | Required decision or evidence |
| --- | --- |
| Primary destination | Exact verified address, managed form endpoint, or other owned channel |
| Ownership evidence | Who controls the destination and how access was verified |
| Visitor-facing label (PL) | Polish wording shown beside the channel |
| Visitor-facing label (EN) | English equivalent |
| Independent manual-send destination | Separately verified visitor-facing destination required whenever automatic submission is activated |
| Expected response time | Confirm or revise the current 1–2 business day commitment |
| Processor suitability | Provider terms/DPA, data region, subprocessors, and suitability for EU and Polish personal-data handling |
| Data handling | Where inquiries are stored, who can access them, and applied retention/deletion settings |
| Server-side validation | Required fields, accepted formats, field-size limits, and malformed/oversized request rejection configured on the selected endpoint |
| Abuse controls | Spam protection, rate limiting, origin restrictions, or provider equivalent configured on the selected endpoint |
| Browser security | Evidence that the endpoint is designed for public-browser use and that no provider secret or API token is shipped to the client |
| Failure behavior | Exact fallback when automatic submission or copying fails, preserving entered data |
| Activation approver | Owner who confirms production activation |

## Verification before activation

- Verify the primary destination by sending a non-production test inquiry and confirming owner-side receipt.
- If automatic submission is enabled, verify the independent manual-send destination separately and confirm that a copied request can be delivered there during an endpoint outage.
- Confirm the initial buyer-facing render is Polish-first and that PL and EN labels, status messages, errors, fallback instructions, and privacy disclosures are equivalent and never mixed on one page.
- Confirm no inactive placeholder, invented social channel, or unverified `mailto:` remains visible.
- Confirm the generated preview, copy action, manual-send instructions, and preservation of entered form data are implemented and tested before describing them as available.
- Confirm privacy/order information matches the selected provider, processor terms, data region, access model, and actual retention/deletion settings.
- Verify configured server-side required-field, format, size-limit, malformed-request, and oversized-request rejection behavior.
- Verify configured spam, rate-limit, and origin or equivalent abuse controls against the selected endpoint.
- Inspect the production bundle and deployed network requests to confirm no provider secret, private API token, or privileged credential reaches the browser.
- Verify mobile and desktop request flow on the deployed GitHub Pages site.
- Verify console and network behavior for the final deployed commit.
- Record exact-SHA CI and review evidence for the implementation PR.

## Activation gate

The contact channel is **not production-ready** until:

1. all required owner-decision fields above are completed;
2. the primary destination is verified end to end;
3. any automatic submission has a separately verified manual-send destination;
4. Polish-first PL/EN buyer-facing copy is implemented without mixed-language states;
5. the generated preview, copy action, manual-send instructions, and data-preservation behavior are implemented and tested;
6. processor suitability, privacy, retention/deletion, server-side validation, abuse controls, and secret-free browser delivery are configured, verified, and documented;
7. final exact-SHA CI is green and review gates pass.

## Explicitly out of scope

This decision does not justify authentication, customer accounts, cart, checkout, payments, a custom database, or a custom admin panel. Prefer the smallest managed solution that satisfies the activation gate.