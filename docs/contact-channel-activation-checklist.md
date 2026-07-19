# Contact channel activation checklist

Status: **owner decision required**

This checklist records the minimum decisions and evidence required before VITAO presents a visitor-facing inquiry destination as active. It supports Issues #28, #30, and the preconditions for Issue #22.

## Current confirmed facts

- `hello@vitao.studio` is unverified and must not be displayed as an active address or clickable `mailto:` link.
- VITAO serves buyers in `Gdańsk / Trójmiasto, Polska` and delivers across Poland.
- The usual response target is within 1–2 business days.
- Buyer-facing contact and request content must default to Polish and follow the selected PL/EN language without mixed-language states.

## Owner decision record

Complete the decision fields in this section before implementation starts. Configuration and test evidence belong in the activation-evidence section after a provider or destination is selected.

| Field | Required decision |
| --- | --- |
| Primary destination | Exact verified address, managed form endpoint, or other owned channel |
| Ownership | Named owner responsible for destination access and production activation |
| Visitor-facing label (PL) | Polish wording shown beside the channel |
| Visitor-facing label (EN) | English equivalent |
| Independent manual-send destination | Separately verified visitor-facing destination required whenever automatic submission is activated |
| Expected response time | Confirm or revise the current 1–2 business day commitment |
| Provider and processor basis | Selected provider plus terms/DPA, intended data region, known subprocessors, and owner approval for EU and Polish personal-data handling |
| Intended data handling | Planned inquiry storage, authorized access, retention period, and deletion workflow |
| Intended validation and abuse controls | Provider capabilities selected for server-side validation, spam protection, rate limiting, origin restrictions, or equivalent controls |
| Browser security model | Evidence that the selected endpoint is intended for public-browser use without shipping provider secrets or private API tokens |
| Failure behavior | Planned fallback when automatic submission or copying fails, preserving entered data |
| Activation approver | Owner who will confirm production activation after implementation evidence is complete |

## Implementation and activation evidence

Collect this evidence after the owner decision record is approved and the selected destination or provider has been configured. None of these items is a prerequisite for starting the implementation slice.

- Verify the primary destination by sending a non-production test inquiry and confirming owner-side receipt.
- If automatic submission is enabled, verify the independent manual-send destination separately and confirm that a copied request can be delivered there during an endpoint outage.
- Confirm the initial buyer-facing render is Polish-first and that PL and EN labels, status messages, errors, fallback instructions, and privacy disclosures are equivalent and never mixed on one page.
- Confirm no inactive placeholder, invented social channel, or unverified `mailto:` remains visible.
- Confirm the generated preview, copy action, manual-send instructions, and preservation of entered form data are implemented and tested before describing them as available.
- Record the applied inquiry storage, authorized access, retention/deletion configuration, and tested owner deletion workflow.
- Confirm privacy/order information matches the selected provider, processor terms, data region, access model, and actual retention/deletion settings.
- Verify configured server-side required-field, format, size-limit, malformed-request, and oversized-request rejection behavior.
- Verify configured spam, rate-limit, and origin or equivalent abuse controls against the selected endpoint.
- Inspect the production bundle and deployed network requests to confirm no provider secret, private API token, or privileged credential reaches the browser.
- Verify mobile and desktop request flow on the deployed GitHub Pages site.
- Verify console and network behavior for the final deployed commit.
- Record exact-SHA CI and review evidence for the implementation PR.

## Activation gate

The contact channel is **not production-ready** until:

1. all required owner-decision fields above are completed and approved;
2. the primary destination is verified end to end;
3. any automatic submission has a separately verified manual-send destination;
4. Polish-first PL/EN buyer-facing copy is implemented without mixed-language states;
5. the generated preview, copy action, manual-send instructions, and data-preservation behavior are implemented and tested;
6. processor suitability, privacy, retention/deletion, server-side validation, abuse controls, and secret-free browser delivery are configured, verified, and documented in the implementation evidence;
7. final exact-SHA CI is green and review gates pass.

## Explicitly out of scope

This decision does not justify authentication, customer accounts, cart, checkout, payments, a custom database, or a custom admin panel. Prefer the smallest managed solution that satisfies the activation gate.
