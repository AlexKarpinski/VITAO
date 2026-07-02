# VITAO Codex Tasks

Use these tasks sequentially. Keep each task small and create a pull request for meaningful changes.

All tasks must follow:

- `AGENTS.md`
- `docs/engineering-standards.md`
- `docs/design-direction.md`

## Task 1 — Initialize Static React MVP

Create the initial VITAO static website app.

### Context

Read before implementation:

- `AGENTS.md`
- `docs/product-brief.md`
- `docs/design-direction.md`
- `docs/engineering-standards.md`
- `docs/roadmap.md`

### Requirements

- Set up Vite + React + TypeScript.
- Set up a lightweight test stack with Vitest, React Testing Library, and `@testing-library/jest-dom`.
- Keep the repository ready for GitHub Pages deployment.
- Create a clean folder structure.
- Add typed static product data in `src/data/products.ts`.
- Add product helper logic if useful, for example `getProductBySlug` or category helpers.
- Add reusable components for layout and product cards.
- Add basic routing for MVP pages:
  - Home
  - Products
  - Product Detail
  - Custom Order
  - About
  - Contact + FAQ
- Implement a first-pass premium visual design based on `docs/design-direction.md`.
- Follow clean code rules from `docs/engineering-standards.md`.
- Do not add backend, database, cart, payments, auth, admin, or CMS.
- Update README with local development, build, test, and preview commands.
- Run build and tests, then fix all errors.

### Acceptance Criteria

- `npm run build` passes.
- `npm run test` passes.
- All MVP pages can be reached through navigation.
- Product cards are rendered from typed static data.
- Product detail pages use the same product data source.
- At least one useful unit test exists for product data/helper logic.
- At least one useful component test exists if a reusable component contains behavior or rendering logic worth protecting.
- Design direction feels warm-minimal and boutique.
- Code follows `docs/engineering-standards.md`.
- No unnecessary dependencies are introduced.

## Task 2 — Polish Home and Catalog

After Task 1 is merged, improve:

- Home hero
- featured product cards
- custom order CTA
- product catalog category chips
- responsive spacing
- footer layout

Also:

- Add or update tests for product filtering/category behavior if implemented.
- Keep components small and reusable.
- Avoid unrelated refactors.

## Task 3 — Product Detail and Custom Order Flow

After Task 2 is merged, improve:

- product detail gallery layout
- material/color/size information
- custom order form visual layout
- custom item examples and price ranges
- contact CTA integration

Also:

- Add or update tests for product lookup, option rendering, or form validation if implemented.
- Keep the custom order form static unless a backend is explicitly requested.

## Task 4 — About, Contact, and FAQ Polish

After Task 3 is merged, improve:

- about story and studio identity
- values section
- materials/process explanation
- contact options
- FAQ content and layout

Also:

- Add tests only where there is meaningful logic or behavior.
- Avoid snapshot tests for static copy.

## Task 5 — GitHub Pages Launch Prep

After core pages are stable:

- configure GitHub Pages deployment if not done
- add SEO metadata
- add favicon placeholder
- add Open Graph metadata
- verify production build paths
- document launch steps

Also:

- Ensure build and tests pass before launch.
- Keep launch changes focused and reversible.
