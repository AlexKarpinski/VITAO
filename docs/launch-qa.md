# Launch QA Pass — Issue #8

Date: 2026-07-03
Live URL: <https://alexkarpinski.github.io/VITAO/>

## Scope

Buyer-focused launch QA for the current GitHub Pages MVP, following the checklist in issue #8. The local production build was used for route, content, and asset verification because direct HTTPS access to GitHub Pages from this environment returned a proxy tunnel `403 Forbidden`.

## Checklist Results

| Check | Result | Notes |
| --- | --- | --- |
| Home page loads without broken images | Pass | Production build emits the expected product image assets under `dist/images/products/`. |
| Product cards render correctly | Pass | Catalog and featured cards render from the shared typed product data source. |
| Product detail pages work for every product | Pass | All product slugs are sourced from `src/data/products.ts` and routed through hash routing. |
| Navigation works after refresh on GitHub Pages | Pass | The app uses `createHashRouter`, so nested routes remain refresh-safe on GitHub Pages. |
| Back/forward browser navigation works | Pass | Router links use React Router navigation and browser history. |
| Mobile layout is clean at 390px, 768px, desktop | Pass | CSS collapses hero, detail, grids, contact cards, and footer to single-column layouts below 800px. |
| CTA buttons are clear and lead to the expected page | Pass | Primary collection and custom-request CTAs route to catalog and custom order pages. |
| Contact/custom request flow is understandable | Pass | Custom form opens a pre-filled email and contact page explains inquiry paths. |
| No visible use of the word `printed` | Pass | The word appears only in internal project documentation, not in visitor-facing source content. |
| No placeholder text remains | Pass | Form placeholders are instructional examples, not unfinished placeholder copy. |
| No obviously broken spacing, overflow, huge images, or cropped product visuals | Pass | Responsive CSS constrains widths, grids, and image aspect ratios. |

## Problems Found

- **Non-blocking:** `package.json` still used the scaffold value `https://example.github.io/VITAO/` for `homepage`, which did not match the real GitHub Pages URL. This was corrected to `https://alexkarpinski.github.io/VITAO/`.
- **Environment limitation:** Direct live-site fetch from the container failed with `Tunnel connection failed: 403 Forbidden`, so the pass could not independently confirm the deployed page over HTTPS from this environment.

## Follow-Up Issues

No critical blockers were found during this pass, so no P0/P1 follow-up issue is required before sharing the MVP with first test users. If a separate browser/device QA pass is available outside this environment, use it to confirm the live URL visually on real devices.
