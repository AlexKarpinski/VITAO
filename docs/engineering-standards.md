# VITAO Engineering Standards

These standards apply to all implementation work in this repository.

## Engineering Goal

Keep the VITAO MVP simple, maintainable, typed, testable, and easy to extend later.

The project is a static MVP first. Good engineering means clear boundaries and clean code, not unnecessary architecture.

## Clean Code Principles

- Prefer simple, readable code over clever abstractions.
- Keep components small and focused on one responsibility.
- Extract repeated UI patterns into reusable components.
- Avoid deeply nested JSX.
- Avoid large components that mix layout, data mapping, conditional logic, and styling concerns.
- Use clear names for components, props, types, and functions.
- Keep business/product data outside UI components.
- Avoid magic strings where a typed model or constant makes the code safer.
- Do not introduce global state unless there is a clear need.
- Do not add backend-like abstractions for static MVP data.

## TypeScript Rules

- Use explicit domain types for product data and page models.
- Avoid `any`. If unknown data is unavoidable, use `unknown` and narrow it.
- Keep prop types close to the component or in a shared type file when reused.
- Prefer discriminated unions when modelling variants.
- Do not suppress TypeScript errors unless there is a documented reason.
- Keep exported types intentional and minimal.

## React Best Practices

- Prefer functional components.
- Keep presentational components stateless where possible.
- Keep page components as composition layers.
- Do not put static product data inside React components.
- Use keys based on stable IDs/slugs, not array indexes.
- Avoid unnecessary effects. Do not use `useEffect` for derived values.
- Keep accessibility in mind: semantic headings, labels, alt text, button/link intent.

## Styling Rules

- Keep styling consistent with `docs/design-direction.md`.
- Use shared design tokens where possible: colors, spacing, radius, typography.
- Avoid one-off inline styles unless truly necessary.
- Prefer reusable class patterns for buttons, cards, sections, grids, and layout.
- Keep responsive behavior deliberate and easy to inspect.

## Testing Strategy

Use tests to protect logic and important UI behavior without slowing the MVP down.

Preferred test stack for a Vite + React app:

- Vitest for unit tests
- React Testing Library for component tests
- `@testing-library/jest-dom` for DOM assertions

Do not add heavy end-to-end tooling in the MVP unless explicitly requested.

## What to Test

Prioritize tests for:

- product data helpers
- product lookup by slug
- price formatting if implemented
- category filtering if implemented
- reusable UI components with logic
- routing/navigation smoke behavior if practical
- forms validation if implemented

Avoid over-testing:

- pure static copy
- visual-only layout details
- implementation details
- CSS class names unless they represent behavior

## Test File Conventions

Recommended patterns:

```text
src/data/products.test.ts
src/components/product/ProductCard.test.tsx
src/pages/ProductsPage.test.tsx
```

Keep tests near the code they validate unless the project later grows enough to justify a separate test structure.

## Quality Gates

Every meaningful PR should pass:

```text
npm run build
npm run test
```

When linting is added, PRs should also pass:

```text
npm run lint
```

If a script does not exist yet, Codex should add it as part of the relevant setup task or explicitly explain why it is not included.

## Dependency Rules

- Keep dependencies minimal.
- Do not add a dependency for simple logic that can be written clearly in a few lines.
- Prefer well-known, maintained tools.
- Explain why a new dependency is needed in the PR summary.
- Do not add UI frameworks unless explicitly requested.

## PR Quality Expectations

A good PR should:

- solve one focused task
- keep scope controlled
- include or update tests for new logic
- update docs when needed
- keep the app buildable
- avoid unrelated refactors
- include a clear summary and validation notes

## MVP Architecture Boundaries

Allowed for MVP:

- static product data
- static routes/pages
- reusable UI components
- simple forms without backend submission
- contact links
- GitHub Pages deployment

Not allowed unless explicitly requested:

- backend
- database
- auth
- cart
- checkout
- payment provider
- CMS
- admin panel
- complex global state
