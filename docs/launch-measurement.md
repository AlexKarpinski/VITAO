# Launch Measurement Plan — Issue #11

Date: 2026-07-03
Status: Planning only — no analytics script or tracking service is installed.

## Goal

Measure whether the VITAO MVP attracts qualified attention and whether visitors show buying intent by clicking request, product, and contact calls to action.

This plan intentionally keeps the site static and lightweight until an analytics provider is explicitly approved.

## Analytics Tool Decision

Use a privacy-friendly, lightweight analytics tool later, with **Plausible Analytics** as the preferred option for launch validation.

Reasons:

- small script footprint suitable for a static MVP
- simple pageview and custom-event reporting
- no cart, checkout, account, or backend requirement
- enough UTM and referrer reporting for early traffic experiments
- easier to explain to visitors than a complex advertising stack

Do **not** add the Plausible script, another tracking script, cookies, pixels, or tag manager until explicitly approved in a future issue.

## Measurement Principles

- Track intent signals, not vanity details.
- Keep events few, stable, and easy to compare week to week.
- Use clear event names that describe the visitor action.
- Avoid collecting personal inquiry content in analytics.
- Keep the static site functional if analytics is blocked or disabled.
- Review results manually during the MVP instead of building dashboards into the site.

## Events to Track Later

| Event name | Visitor action | Primary locations | Why it matters | Suggested properties |
| --- | --- | --- | --- | --- |
| `home_cta_click` | Visitor clicks a primary home CTA | Home hero, home custom-order section, final CTA | Measures whether the landing page creates enough intent to continue | `cta_label`, `target_path`, `section` |
| `product_card_click` | Visitor opens a product from a card | Featured products, catalog grid, related products | Measures product interest by item and placement | `product_slug`, `product_name`, `category`, `source_section` |
| `product_request_click` | Visitor clicks a request CTA for a specific product | Product detail page | Measures item-level buying intent | `product_slug`, `product_name`, `category`, `cta_label` |
| `custom_request_click` | Visitor starts a custom-order inquiry | Header, home, product detail, custom order page | Measures demand for made-to-order work | `source_path`, `source_section`, `cta_label` |
| `contact_click` | Visitor clicks email, Instagram, Telegram, or another contact option | Contact page, footer, custom order flow | Measures which conversation channel visitors prefer | `contact_type`, `source_path`, `source_section` |

## Conversion Questions

Use the events above to answer these launch questions:

1. Which traffic sources send visitors who click request or contact CTAs?
2. Which product categories get the most card clicks?
3. Which individual products create request intent?
4. Are visitors more likely to start from curated products or from custom-order messaging?
5. Which contact channel should be emphasized after the first traffic experiments?

## UTM Guidance for First Traffic Experiments

Use UTM parameters on every external launch link so early traffic can be compared without adding campaign complexity.

Recommended format:

```text
https://alexkarpinski.github.io/VITAO/?utm_source=<source>&utm_medium=<medium>&utm_campaign=<campaign>&utm_content=<variant>
```

### UTM Fields

| Parameter | Use | Examples |
| --- | --- | --- |
| `utm_source` | Where the visitor came from | `instagram`, `telegram`, `reddit`, `personal_dm`, `facebook` |
| `utm_medium` | Type of placement or outreach | `social`, `dm`, `post`, `story`, `community` |
| `utm_campaign` | Experiment or launch push | `mvp_launch`, `desk_setup_test`, `custom_orders_test` |
| `utm_content` | Creative, message, or audience variant | `hero_product`, `custom_offer`, `desk_tray`, `vanity_organizer` |

### Example Links

```text
https://alexkarpinski.github.io/VITAO/?utm_source=instagram&utm_medium=story&utm_campaign=mvp_launch&utm_content=custom_offer
https://alexkarpinski.github.io/VITAO/?utm_source=telegram&utm_medium=dm&utm_campaign=mvp_launch&utm_content=desk_setup
https://alexkarpinski.github.io/VITAO/?utm_source=reddit&utm_medium=community&utm_campaign=desk_setup_test&utm_content=ridge_tray
```

## First Launch Review Cadence

Review results manually after each traffic push:

- after the first 24 hours
- after the first 7 days
- after each distinct audience or creative experiment

Record:

- source and UTM link used
- approximate audience size or number of messages sent
- pageviews and unique visitors
- event counts for request/contact actions
- products or categories with notable interest
- qualitative notes from replies or conversations

## Implementation Checklist for a Future Analytics Issue

When analytics is approved later:

1. Add the selected provider script in the smallest static-safe way.
2. Add a tiny typed event helper instead of scattering provider calls through components.
3. Keep the helper no-op when analytics is unavailable.
4. Wire only the events listed in this document first.
5. Verify production build still passes.
6. Update this document if event names or properties change.

## Explicit Non-Goals

- No tracking script in this issue.
- No cookies, pixel, tag manager, heatmap, session recording, or advertising integration.
- No backend endpoint for analytics.
- No user identity tracking.
- No analytics dashboard inside the VITAO site.
