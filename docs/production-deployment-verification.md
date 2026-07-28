# Production deployment verification

Use this checklist after every GitHub Pages production deployment and before treating the live site as verified for Product Council or market-validation decisions.

This document defines evidence requirements. It does not prove that a deployment, route, product claim, contact destination, or interaction has been validated until the corresponding evidence is recorded.

## Verification record

- Verification date and time (Europe/Warsaw):
- Verifier:
- Expected `main` commit SHA:
- Deployed commit SHA, when exposed:
- Immutable deployment/build identifier, when exposed:
- Evidence linking the deployment/build identifier to the expected commit SHA:
- GitHub Pages deployment/workflow URL:
- Production URL: `https://alexkarpinski.github.io/VITAO/`
- Browser and version:
- Mobile viewport:
- Desktop viewport:
- Result: `PASS`, `FAIL`, `BLOCKED`, or `N/A` for a check that does not apply to the deployed UI
- Access limitation, when blocked:

When production exposes a commit SHA, it must equal the expected `main` SHA. When production exposes only another immutable build or deployment identifier, record evidence from the Pages workflow or deployment metadata that associates that identifier with the expected SHA. When neither relationship can be established, report deployment drift as unverified rather than assuming that production matches `main`.

## Evidence rules

- Separate rendered live-site findings from repository-only observations.
- A DNS, browser, proxy, or audit-tool failure is not evidence that the public site is unavailable.
- Do not claim mobile, desktop, visual, console, network, or accessibility behavior without direct live evidence.
- Never introduce or confirm contact details, product measurements, production data, pickup options, social channels, or user feedback without owner or physical evidence.
- Capture the tested route, viewport, result, and supporting screenshot or browser evidence for every failure.
- Use `N/A` only when the control or behavior is demonstrably absent from the deployed UI; include the observation that makes the check inapplicable.

## Primary route matrix

Check each route directly and through site navigation.

| Route | Polish | English | Mobile | Desktop | Result/evidence |
| --- | --- | --- | --- | --- | --- |
| `#/` |  |  |  |  |  |
| `#/products` |  |  |  |  |  |
| Every `#/products/:slug` route |  |  |  |  |  |
| `#/custom` or the current custom-request route |  |  |  |  |  |
| `#/about` |  |  |  |  |  |
| `#/contact` |  |  |  |  |  |
| Order-information route |  |  |  |  |  |
| Privacy route |  |  |  |  |  |
| Terms route |  |  |  |  |  |

For every route verify:

- the route loads without a blank page or unexpected redirect;
- navigation and footer remain usable;
- no obvious overflow, clipping, overlap, missing content, or mixed-language state appears;
- expected images and icons load;
- internal links remain inside the GitHub Pages base path;
- browser console and Network tabs contain no unexplained error or failed request.

## Polish-first and English fallback

- Open production in a clean browser context with no saved language preference.
- Confirm Polish is selected by default and buyer-facing content is consistently Polish.
- Switch to English and confirm the current page contains no unintended Polish buyer-facing copy.
- Refresh and navigate across all primary routes; confirm the English choice persists.
- Switch back to Polish and confirm persistence after refresh.
- Confirm `document.documentElement.lang` matches the selected language.
- Confirm prices remain in zł and product or brand names are unchanged where intended.

## Navigation and footer

- Test the primary navigation with pointer and keyboard.
- At mobile width, verify the navigation remains usable without clipping or inaccessible controls.
- When a collapsible mobile menu is present, open and close it and confirm focus remains usable. Record `N/A` when the deployed header intentionally uses flat navigation and no menu control exists.
- Confirm the current-page state is understandable.
- Check every footer link in both languages.
- Confirm legal and order-information links open the intended route.
- Confirm no placeholder social link, invented handle, or unverified external destination is present.

## Catalog and product detail

For every listed product:

- confirm the card opens the correct detail page;
- confirm the product name and price match between listing and detail page;
- confirm the price uses zł;
- confirm the primary image loads and has meaningful alternative text;
- confirm the layout remains usable at mobile and desktop widths;
- record any buyer-facing dimension, material, production, or delivery claim that lacks linked physical evidence under Issue #29 rather than treating it as validated.

## Contact and custom request

- Confirm `Gdańsk / Trójmiasto, Polska`, delivery across Poland, and the usual response within 1–2 business days appear only where intended and in the selected language.
- Confirm `hello@vitao.studio` is not presented as verified or clickable while it remains unverified.
- Confirm no unapproved `mailto:`, social, marketplace, or form destination is exposed.
- Complete the custom-request form in Polish and English.
- Confirm validation and error copy use the selected language.
- When the preview/copy fallback is deployed, verify generated text, Clipboard success, Clipboard failure/manual-copy behavior, preservation of entered data, draft clearing, and absence of a false delivery claim.
- Do not report a request as submitted or received without end-to-end destination evidence.

## Accessibility basics

- Navigate all interactive controls using keyboard only.
- Confirm visible focus indication.
- Confirm every form control has an understandable label.
- Confirm validation and status feedback is exposed to assistive technology.
- Check heading order and landmark structure.
- Confirm informative images have useful alternative text and decorative images are ignored appropriately.
- Check obvious text/background contrast failures.
- Confirm language changes update the document language.

## Technical and metadata checks

- Record console errors and warnings with route and reproduction steps.
- Record every failed document, JavaScript, CSS, image, font, manifest, or other network request.
- Confirm viewport metadata.
- Confirm title, description, canonical URL, favicon, manifest, Open Graph, and Twitter metadata are returned by production.
- Confirm canonical and asset URLs use the intended GitHub Pages project base.
- Check every external link for a real approved destination, HTTPS, and safe new-tab behavior where applicable.

## Severity and issue handling

Create or update a GitHub issue only when the finding is reproducible and supported by live evidence.

- `P0`: primary site unavailable to ordinary users, all buyer routes unusable, or a severe security/privacy exposure.
- `P1`: broken primary route, missing critical assets, unusable language or request flow, false submission claim, active unverified contact, major mobile/desktop breakage, or deployment drift affecting validation.
- `P2`: localized visual, metadata, accessibility, or consistency issue that does not block the primary validation flow.

Prefer an existing suitable issue. A new issue must include:

- production URL and exact route;
- verification timestamp and viewport;
- deployed build identifier when available;
- reproduction steps;
- expected and actual result;
- screenshots, console output, or network evidence;
- severity and user impact;
- dependencies and acceptance criteria.

Do not create repetitive issues or comments for the same audit-environment access failure.

## Completion gate

A production verification is complete only when:

- the deployed commit SHA matches the intended `main` commit, or an immutable deployment/build identifier is supported by evidence linking it to that commit;
- every primary route has live evidence at mobile and desktop widths;
- Polish-default and English-persistence checks pass;
- navigation, footer/legal links, images, prices, contact safety, and the currently deployed custom-request behavior pass, with demonstrably inapplicable controls recorded as `N/A`;
- console and failed-network checks are recorded;
- metadata, canonical, and approved external links are checked;
- every concrete regression is linked to an issue with evidence;
- remaining blocked checks are explicitly reported as unverified, not passed.
