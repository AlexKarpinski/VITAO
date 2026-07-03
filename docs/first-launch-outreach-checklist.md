# First Launch and Outreach Checklist — Issue #14

Date: 2026-07-03
Status: Planning checklist for first public MVP sharing.

## Goal

Give VITAO a practical launch runbook for the first real visitors: confirm the site is ready, share it with a small qualified audience, track what was sent, and review whether the MVP creates custom-order conversations.

This checklist keeps launch activity lightweight and manual. It does not add backend systems, checkout, tracking scripts, email automation, or a CRM.

## Launch Readiness Checklist

Complete these checks before the first outreach push.

### Site and Content

- [ ] Confirm the public GitHub Pages URL opens: <https://alexkarpinski.github.io/VITAO/>.
- [ ] Visit each primary route from the header and footer:
  - [ ] Home
  - [ ] Products
  - [ ] Product detail pages for all visible products
  - [ ] Custom Order
  - [ ] About
  - [ ] Contact + FAQ
- [ ] Confirm all product cards show a product image, name, category, short description, and price/range.
- [ ] Confirm custom-order CTAs lead to the Custom Order page or a clear contact action.
- [ ] Confirm contact links are current and lead to the intended email, Instagram, Telegram, or preferred channel.
- [ ] Confirm no visible unfinished placeholder copy remains.
- [ ] Confirm the visible language feels premium, warm, and product-first rather than technical or cheap.

### Mobile and Visual QA

- [ ] Check the site on a phone-width viewport around 390px.
- [ ] Check the site on a tablet-width viewport around 768px.
- [ ] Check the site on a desktop-width viewport.
- [ ] Confirm product images are not distorted, cropped awkwardly, or missing.
- [ ] Confirm forms and links are easy to tap on mobile.
- [ ] Confirm the header navigation, footer links, and product grid remain readable on mobile.

### Build and Release

- [ ] Run `npm run build` locally before sharing the link.
- [ ] Run `npm run test -- --run` locally before sharing the link.
- [ ] Confirm the deployed page reflects the latest committed changes.
- [ ] Keep the launch scope static: no backend, cart, checkout, payment provider, auth, CMS, admin, tracking pixels, or tag manager.

## Outreach Audience Plan

Start with a small audience that can give specific feedback or realistically request a product. Prioritize personal relevance over broad reach.

| Audience | Size target | Why this group matters | Suggested angle |
| --- | ---: | --- | --- |
| Desk setup and remote-work contacts | 10–20 people | Strong fit for trays, pen cups, and desk organizers | “Would this improve your desk setup?” |
| Home organization or interior-minded contacts | 10–15 people | Strong fit for catch-all trays and small home objects | “Which small object would be useful in your space?” |
| Beauty / vanity organization contacts | 5–10 people | Strong fit for cosmetic organizers | “Would a custom-sized vanity organizer be useful?” |
| Gaming setup contacts | 5–10 people | Strong fit for controller, headset, and display stands | “Would this match your setup better than generic stands?” |
| Warm local network | 10–20 people | Good source of early trust and custom requests | “I’m validating a small made-to-order object studio.” |

## Outreach Message Templates

Use short, personal messages. Send manually and adjust the wording to the person so it does not feel like a mass campaign.

### Personal DM — General

```text
Hey! I’m testing the first version of VITAO, a small studio concept for refined made-to-order objects for desks, homes, and everyday routines.

Could you take a quick look and tell me what feels useful, unclear, or worth requesting?

https://alexkarpinski.github.io/VITAO/?utm_source=personal_dm&utm_medium=dm&utm_campaign=mvp_launch&utm_content=general_feedback
```

### Desk Setup Angle

```text
Hey! I’m validating VITAO, a small made-to-order object studio. I’m especially testing desk trays, pen cups, and organizers for calmer workspaces.

Would you look at this and tell me which object, if any, you’d actually consider for your desk?

https://alexkarpinski.github.io/VITAO/?utm_source=personal_dm&utm_medium=dm&utm_campaign=desk_setup_test&utm_content=desk_feedback
```

### Custom Order Angle

```text
Hey! I’m testing whether people want small custom objects made around their exact space — desk, vanity, gaming setup, or home organization.

If you had one awkward spot that needed a better organizer or stand, what would it be?

https://alexkarpinski.github.io/VITAO/?utm_source=personal_dm&utm_medium=dm&utm_campaign=custom_orders_test&utm_content=custom_prompt
```

### Social Post

```text
I’m launching the first MVP for VITAO — a small studio concept for refined made-to-order objects for modern desks, homes, and everyday routines.

The goal is simple: learn which products people actually want before building anything bigger.

If you like calm organization, desk setups, vanity organizers, or custom small objects, I’d love your feedback:

https://alexkarpinski.github.io/VITAO/?utm_source=instagram&utm_medium=post&utm_campaign=mvp_launch&utm_content=public_post
```

## Outreach Tracking Sheet

Use a simple spreadsheet or notes document with these columns. Keep it manual for the first launch.

| Column | What to record |
| --- | --- |
| Date | Date the message or post was sent |
| Channel | Instagram, Telegram, email, Reddit, direct message, local group, etc. |
| Audience | Desk setup, vanity, gaming, home organization, warm network, etc. |
| UTM link | Exact link shared |
| Message variant | General, desk setup, custom order, social post, etc. |
| Sent count | Approximate number of people reached |
| Replies | Number of replies or comments |
| Product interest | Products/categories mentioned positively |
| Custom request interest | Any custom object requests or concrete ideas |
| Friction | Confusing copy, pricing doubts, missing info, trust concerns |
| Follow-up action | Update copy, add FAQ, message back, create quote, etc. |

## First Launch Sequence

### Day 0 — Final QA

- [ ] Complete the launch readiness checklist.
- [ ] Prepare 3–5 UTM links using the guidance in `docs/launch-measurement.md`.
- [ ] Prepare the outreach tracking sheet.
- [ ] Choose the first 20–30 warm contacts.

### Day 1 — Warm Manual Outreach

- [ ] Send personal DMs to the first warm contacts.
- [ ] Ask one specific question instead of asking for generic feedback.
- [ ] Record sent count, links, replies, and qualitative notes.
- [ ] Reply manually to anyone who shows custom-order intent.

### Day 2–3 — Focused Audience Test

- [ ] Pick one audience angle: desk setup, vanity organization, gaming/display, or home organization.
- [ ] Share one focused link and message variant.
- [ ] Record which products or categories get mentioned.
- [ ] Note any objections about price, materials, timing, sizing, or contact flow.

### Day 7 — Review and Decide

- [ ] Summarize traffic, replies, product interest, and custom-order interest.
- [ ] Identify the strongest product category or audience.
- [ ] Identify the biggest source of friction.
- [ ] Decide the next small change: copy tweak, FAQ addition, product reorder, stronger CTA, or new product concept.
- [ ] Do not add checkout, cart, backend, analytics scripts, or automation unless a follow-up issue explicitly approves it.

## Success Signals

Treat the first launch as successful if it produces learning, not just traffic.

Strong signals:

- at least 3–5 people reply with a specific product or custom object they would consider
- at least 1–2 people ask about price, sizing, color, lead time, or ordering
- one product category clearly gets more interest than the others
- visitors understand that VITAO is made-to-order and conversation-led

Weak signals to investigate:

- people say the site looks nice but mention no product or use case
- people do not understand how to request a piece
- people ask whether checkout is missing
- visitors focus on technical 3D-printing details rather than product outcomes
- product categories feel too broad or too generic

## Follow-Up Decision Log

After the first week, record:

```text
Launch review date:
Most promising audience:
Most mentioned product/category:
Best-performing message or channel:
Top objections or confusion:
Recommended next content/product change:
Recommended next outreach test:
Do not build yet:
```

## Explicit Non-Goals

- No backend, database, cart, checkout, payment provider, account system, CMS, or admin panel.
- No tracking scripts, pixels, tag managers, heatmaps, or session recording.
- No automated cold outreach.
- No broad paid ads before the first manual learning loop is reviewed.
- No large redesign before qualitative launch feedback is collected.
