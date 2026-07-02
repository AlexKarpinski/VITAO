# VITAO Agent Guide

Use this file as the primary instruction source when working in this repository.

## Project Summary

VITAO is a premium MVP website for a small custom 3D-printed objects brand.

The site should feel like a boutique product studio, not a technical 3D-printing service.

## Product Positioning

VITAO creates functional, refined, small design objects for modern everyday spaces:

- desk trays and organizers
- pen cups
- cosmetic and vanity organizers
- catch-all trays
- gaming and display stands
- custom objects made to order

Primary MVP goal: validate demand through a polished static website and custom order requests.

## Tech Direction

Preferred stack:

- Vite
- React
- TypeScript
- Static product data
- GitHub Pages deployment
- Vitest + React Testing Library for tests

Do not add a backend, database, payment provider, user auth, cart, admin panel, or CMS unless explicitly requested.

## Required Context

Before making implementation changes, read:

- `docs/product-brief.md`
- `docs/design-direction.md`
- `docs/engineering-standards.md`
- `docs/roadmap.md`
- `docs/codex-tasks.md`

## Design Direction

Use the design direction from `docs/design-direction.md`.

Core feeling:

- premium
- warm minimal
- calm
- editorial
- product-first
- gallery-like
- refined but not overdesigned

Avoid:

- cheap 3D-printer visuals
- neon tech look
- generic SaaS templates
- heavy animations
- cartoonish icons
- cluttered ecommerce layouts

## Coding Rules

- Follow `docs/engineering-standards.md`.
- Keep the code simple and easy to extend.
- Prefer small, readable components.
- Keep static product data in a single typed data file.
- Use TypeScript types for product data and page models.
- Avoid `any` unless there is a documented reason.
- Do not introduce heavy dependencies without explaining why.
- Keep styling consistent with the design system.
- Ensure the site builds successfully before completing a task.
- Add or update tests for logic and important reusable components.
- Update docs when behavior or structure changes.

## Suggested Structure

```text
src/
  assets/
  components/
    layout/
    product/
    sections/
    ui/
  data/
    products.ts
  pages/
  styles/
  test/
  types/
```

## First MVP Pages

- Home
- Products / Catalog
- Product Detail
- Custom Order
- About
- Contact + FAQ

## Testing Expectations

For the initial Vite + React setup, configure a lightweight test stack:

- Vitest
- React Testing Library
- `@testing-library/jest-dom`

Add useful tests for:

- typed product data helpers
- product lookup by slug
- product cards when they include logic
- category/filter behavior when implemented
- form validation when implemented

Avoid low-value snapshot tests and tests that only duplicate static copy.

## Completion Checklist

Before finishing a task, verify:

- `npm run build` passes
- `npm run test` passes if tests are configured
- TypeScript errors are fixed
- layout works at desktop and mobile widths
- no backend/payment/cart/auth was added accidentally
- visual direction still feels premium and boutique
- tests were added or updated for meaningful logic
- README or docs were updated if needed
