# VITAO

VITAO is a premium static shop MVP for small custom 3D-printed design objects.

The goal is not to look like a cheap 3D-printer store. VITAO should feel like a calm boutique product brand: warm minimalism, useful objects, refined presentation, and an easy path to request a custom piece.

## MVP Goal

Build a static website that can be deployed to GitHub Pages and used to validate demand before adding backend, payments, or a full checkout flow.

The MVP helps visitors:

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

## Tech Stack

- Vite
- React
- TypeScript
- React Router
- Static typed product data
- Plain CSS design system
- GitHub Pages-ready production base path

No backend, cart, payment, auth, admin panel, CMS, or database is included in this MVP.

## Project Structure

```text
src/
  components/
    layout/      # Header, footer, page shell
    product/     # Product card and product-focused UI
    sections/    # Reusable page sections
    ui/          # Small reusable UI primitives
  data/          # Static typed product data
  pages/         # Route-level page components
  styles/        # Global styles and design tokens
  types/         # Shared TypeScript types
```

## Local Development

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Build the production site:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## GitHub Pages Notes

The Vite config uses `/VITAO/` as the production base path so the generated assets work when deployed under a GitHub Pages project site URL such as `https://<user>.github.io/VITAO/`.
