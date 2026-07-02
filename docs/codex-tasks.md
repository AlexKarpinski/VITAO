# VITAO Codex Tasks

Use these tasks sequentially. Keep each task small and create a pull request for meaningful changes.

## Task 1 — Initialize Static React MVP

Create the initial VITAO static website app.

### Context

Read before implementation:

- `AGENTS.md`
- `docs/product-brief.md`
- `docs/design-direction.md`
- `docs/roadmap.md`

### Requirements

- Set up Vite + React + TypeScript.
- Keep the repository ready for GitHub Pages deployment.
- Create a clean folder structure.
- Add typed static product data in `src/data/products.ts`.
- Add reusable components for layout and product cards.
- Add basic routing for MVP pages:
  - Home
  - Products
  - Product Detail
  - Custom Order
  - About
  - Contact + FAQ
- Implement a first-pass premium visual design based on `docs/design-direction.md`.
- Do not add backend, database, cart, payments, auth, admin, or CMS.
- Update README with local development, build, and preview commands.
- Run build and fix all errors.

### Acceptance Criteria

- `npm run build` passes.
- All MVP pages can be reached through navigation.
- Product cards are rendered from typed static data.
- Product detail pages use the same product data source.
- Design direction feels warm-minimal and boutique.
- No unnecessary dependencies are introduced.

## Task 2 — Polish Home and Catalog

After Task 1 is merged, improve:

- Home hero
- featured product cards
- custom order CTA
- product catalog category chips
- responsive spacing
- footer layout

## Task 3 — Product Detail and Custom Order Flow

After Task 2 is merged, improve:

- product detail gallery layout
- material/color/size information
- custom order form visual layout
- custom item examples and price ranges
- contact CTA integration

## Task 4 — About, Contact, and FAQ Polish

After Task 3 is merged, improve:

- about story and studio identity
- values section
- materials/process explanation
- contact options
- FAQ content and layout

## Task 5 — GitHub Pages Launch Prep

After core pages are stable:

- configure GitHub Pages deployment if not done
- add SEO metadata
- add favicon placeholder
- add Open Graph metadata
- verify production build paths
- document launch steps
