# VITAO Product Catalog Strategy

## Strategy Goal

The catalog should validate demand for a small, premium made-to-order object studio before VITAO invests in checkout, inventory, tooling, or a larger product library.

For the MVP, the catalog is a curated conversation starter. It should help visitors imagine what VITAO can make, choose a familiar starting point, and request a version that fits their own desk, home, vanity, gaming setup, or routine.

## Catalog Principles

1. **Curated over exhaustive** — keep the public catalog focused enough to feel intentional, not like a marketplace of random printed objects.
2. **Room-first, not printer-first** — describe products by where they live and what problem they solve; avoid leading with printer specs or manufacturing jargon.
3. **Made-to-order flexibility** — every catalog item should imply small adjustments are welcome, such as size, color, compartments, object fit, or finish.
4. **Repeatable product families** — prioritize ideas that can become families of related objects instead of one-off novelty pieces.
5. **Photographable forms** — choose shapes that can be styled in warm, editorial scenes and communicate premium quality quickly.
6. **Practical production scope** — prefer small-to-medium objects with manageable print time, shipping risk, and finishing effort.
7. **Clear conversion path** — each product idea should lead naturally to “request this piece” or “customize this piece,” not checkout complexity.

## Current MVP Catalog Role

The current MVP catalog covers five demand areas:

- **Desk & Office** for remote workers, students, and tidy workspace customers.
- **Home Organization** for entry tables, bedside surfaces, shelves, and daily-carry objects.
- **Cosmetic & Vanity** for beauty, skincare, and bathroom organization.
- **Gaming & Display** for setup-focused customers who want accessories to look intentional.
- **Custom Pieces** for visitors with unusual dimensions, niche objects, or gift ideas.

This mix should stay broad enough to test which use cases get inquiries while still feeling like one cohesive design studio collection.

## Assortment Shape

For the next public-facing catalog iteration, aim for **10–12 total products** rather than a large SKU count:

- 3–4 desk and office pieces
- 2–3 home organization pieces
- 2 cosmetic or vanity pieces
- 2 gaming or display pieces
- 1 custom-fit entry point

That range gives visitors enough choice to understand the offer while keeping product photography, copy, testing, and maintenance realistic for a static MVP.

## Evaluation Criteria for New Product Ideas

Score future ideas against these criteria before adding them to the public catalog:

| Criterion | What to look for |
| --- | --- |
| Everyday usefulness | Does it solve a repeated, visible problem in a modern space? |
| Premium fit | Can the object feel refined rather than gadget-like or novelty-driven? |
| Customization value | Would visitors reasonably want size, color, compartments, or fit adjustments? |
| Production simplicity | Is it feasible without fragile details, excessive supports, or difficult assembly? |
| Photo potential | Can it be styled clearly with warm, minimal lifestyle imagery? |
| Price clarity | Can it fit a simple “From … zł” or “Quotes from … zł” model? |

## Next 10 Product Ideas

These are the recommended next ideas to explore after the initial MVP catalog. They should be treated as product concepts to validate through inquiries, not as committed inventory.

| Priority | Product idea | Category | Customer use case | Why it fits VITAO | Starting price guidance |
| --- | --- | --- | --- | --- | --- |
| 1 | **Column Cable Dock** | Desk & Office | Keeps charging cables, adapters, and small hubs aligned on a desk or nightstand. | High everyday utility, compact footprint, strong customization for cable count and device type. | From 135 zł |
| 2 | **Layer Desk Tray Set** | Desk & Office | A nested set for paper clips, keys, sticky notes, and daily desk objects. | Builds on the existing tray language while creating a more giftable bundle. | From 179 zł |
| 3 | **Studio Monitor Riser Blocks** | Desk & Office | Small paired risers for monitors, speakers, or laptop stands that need a cleaner height. | Desk setup customers often need custom sizing; simple forms can look architectural and premium. | Quotes from 189 zł |
| 4 | **Orbit Jewelry Stand** | Home Organization | Holds rings, earrings, bracelets, and small bedside jewelry without clutter. | Extends catch-all demand into a more vertical object with strong styling potential. | From 149 zł |
| 5 | **Entry Key Rail** | Home Organization | A compact wall or shelf piece for keys, sunglasses, cards, and dog-walk essentials. | Solves a common entryway problem and invites made-to-fit sizing for small homes. | From 169 zł |
| 6 | **Shelf Label Holders** | Home Organization | Minimal holders for pantry, studio, closet, or office shelf labels. | Lightweight, repeatable, practical, and useful for organized interiors without feeling technical. | From 135 zł per set |
| 7 | **Contour Brush Cup** | Cosmetic & Vanity | Separates makeup brushes, liners, tweezers, and small tools on a vanity. | Natural companion to the Dune organizer; texture and shape can feel tactile and refined. | From 145 zł |
| 8 | **Skincare Step Riser** | Cosmetic & Vanity | A tiered display for serums, small bottles, perfume, and daily skincare. | Strong visual merchandising appeal and clear customization by bottle depth and shelf width. | From 179 zł |
| 9 | **Console Dock Stand** | Gaming & Display | Displays handheld consoles, tablets, or e-readers at a stable angle. | Expands gaming/display beyond controllers while staying useful for everyday devices. | From 169 zł |
| 10 | **Mini Figure Display Plinths** | Gaming & Display | Small plinth set for collectibles, figures, candles, or studio objects. | Gallery-like display language supports VITAO’s premium positioning and can sell as sets. | From 149 zł per set |

## Recommended Next Catalog Additions

If only two or three products are added next, prioritize:

1. **Column Cable Dock** — most direct desk utility and likely to generate custom requests.
2. **Skincare Step Riser** — expands vanity use cases with strong visual appeal.
3. **Console Dock Stand** — broadens gaming/display into everyday device organization.

These three test different audiences without making the catalog feel scattered.

## Copy and Naming Guardrails

Use names that feel calm, spatial, and object-led. Good patterns include:

- natural forms: Ridge, Dune, Wave, Arc, Flow
- simple geometry: Column, Layer, Orbit, Contour
- use-case clarity: Cable Dock, Brush Cup, Step Riser, Display Plinths

Avoid names that sound too technical, playful, or mass-market, such as “Filament Cable Thing,” “Gamer Pro Holder,” or “Mega Organizer.”

## When to Add an Idea to the Site

Add a product concept to `src/data/products.ts` only when VITAO has enough confidence to present it as requestable:

- clear product name and category
- concise customer problem
- realistic dimensions or made-to-fit scope
- starting price or quote range
- color and material options
- warm, product-first image or placeholder that matches the brand direction
- route-safe slug and accessible image alt text

Until then, keep ideas in this strategy document or use them as custom order examples.
