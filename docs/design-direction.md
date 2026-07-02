# VITAO Design Direction

## Design Goal

Create a premium, warm-minimal static ecommerce experience for VITAO.

The website should look like a boutique product brand or small design studio, not a technical 3D-printing service.

## Visual Keywords

- warm minimalism
- gallery-like product presentation
- boutique ecommerce
- soft editorial layout
- tactile materials
- quiet luxury
- functional beauty
- refined everyday objects

## Reference Feeling

Think:

- Muji-like simplicity
- premium interior object photography
- calm design studio
- warm gallery shop
- subtle product storytelling

Do not copy any specific brand. Use these only as mood references.

## Palette Direction

Use a neutral warm palette:

- warm white / ivory background
- stone / sand cards
- near-black typography
- olive or graphite primary accent
- clay / taupe secondary accents

Example values to explore:

```text
Background: #F7F3EC
Surface:    #FFFCF7
Stone:      #E8DFD2
Sand:       #D5C8B8
Olive:      #4B4D34
Graphite:   #1D1D1B
Muted text: #6F6A62
Border:     #E4DDD2
```

## Typography Direction

Use a contrast between elegant headings and clean body text.

Suggested approach:

- large editorial serif headings
- clean sans-serif body copy
- letter-spaced small labels

Possible pairings:

- Playfair Display / Inter
- Cormorant Garamond / Inter
- Fraunces / Manrope
- Libre Baskerville / DM Sans

For MVP, pick fonts that are easy to load and stable.

## Layout Principles

- lots of whitespace
- wide desktop content max-width
- large hero images
- calm section rhythm
- soft rounded cards
- subtle borders, not heavy shadows
- product cards should feel editorial, not discount-store ecommerce
- mobile should be clean and readable, not squeezed

## Product Photography / Visuals

Product visuals should feel:

- realistic
- tactile
- warm-lit
- neutral backgrounds
- home / desk / studio lifestyle setting
- matte surfaces
- organized, calm composition

Avoid:

- colorful filament spools as primary hero image
- messy workshop photos
- harsh neon lighting
- futuristic tech grid backgrounds
- visible cheap printer clutter unless used carefully on About page

## Core Pages Design Notes

### Home

Purpose: communicate premium brand, show featured products, push custom orders.

Sections:

1. Header
2. Hero
3. Featured products
4. Custom orders
5. Materials & quality
6. How it works
7. CTA
8. Footer

### Products

Purpose: curated product catalog.

Use:

- category chips
- simple filter/sort bar
- clean 3- or 4-column desktop grid
- product cards with image, name, price, subtle action button

### Product Detail

Purpose: explain one item and convert to request.

Use:

- image gallery
- product title and short description
- material, color, size options
- CTA: Request this piece
- secondary CTA: Customise this piece
- related products
- customization panel

### Custom Order

Purpose: collect leads for custom pieces.

Use:

- clear process steps
- inquiry form
- example categories and price ranges
- reassurance section

### About

Purpose: make the brand feel real and trustworthy.

Use:

- small studio story
- values
- materials/process
- personal founder block if appropriate

### Contact + FAQ

Purpose: reduce friction and answer common concerns.

Use:

- email / Instagram / Telegram contact cards
- short contact form
- FAQ cards
- final custom order CTA

## Component Style

Buttons:

- rounded but not pill-heavy
- dark olive primary
- subtle outlined secondary
- clear hover states

Cards:

- soft cream surfaces
- rounded corners
- light border
- minimal shadow

Icons:

- thin line icons
- simple and restrained
- no cartoon style

## Copy Tone

Examples:

- Custom printed objects for modern spaces.
- Thoughtfully designed. Expertly printed. Made to elevate the everyday.
- Custom orders, crafted around you.
- Small details. Big impact.
- Design better spaces.

## Implementation Notes

Codex should implement the design as a reusable component system instead of hardcoding each page from scratch.

Suggested reusable components:

- Header
- Footer
- SectionLabel
- Button
- ProductCard
- CTASection
- PageHero
- FeatureCard
- FAQItem
- ProcessStep
