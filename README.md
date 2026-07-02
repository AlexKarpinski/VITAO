# VITAO

VITAO is a premium static shop MVP for small custom 3D-printed design objects.

The goal is not to look like a cheap 3D-printer store. VITAO should feel like a calm boutique product brand: warm minimalism, useful objects, refined presentation, and an easy path to request a custom piece.

## MVP Goal

Build a static website that can be deployed to GitHub Pages and used to validate demand before adding backend, payments, or a full checkout flow.

The MVP should help visitors:

1. Understand what VITAO offers.
2. Browse a small curated product collection.
3. Open product details.
4. Request a custom object or ask a question.

## Initial Pages

- `/` — Home / landing page
- `/products` — Product catalog
- `/products/:slug` — Product detail page
- `/custom` — Custom order inquiry
- `/about` — Brand / studio story
- `/contact` — Contact + FAQ

## Suggested Tech Stack

- Vite
- React
- TypeScript
- Static product data for MVP
- CSS Modules or plain CSS architecture
- GitHub Pages deployment

No backend, cart, payment, or database should be added until explicitly requested.

## Development Direction

See:

- `AGENTS.md` — rules for AI coding agents
- `docs/product-brief.md` — product and MVP context
- `docs/design-direction.md` — visual direction
- `docs/roadmap.md` — planned implementation phases
- `docs/codex-tasks.md` — first tasks for Codex

## Local Development

Install dependencies and run the Vite development server:

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

The app uses hash-based routes so the static build works cleanly on GitHub Pages without a backend rewrite layer.
