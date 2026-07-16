# VITAO V0.2 product specifications

Status: draft for prototype validation  
Scope: Dune Cosmetic Organizer, Modular Desk Organizer, Ridge Tray  
Source issue: #23

## How to use this document

This document is the working specification for modeling, outsourcing, printing, testing, and quoting the first three VITAO products.

Values that have not yet been measured or validated are deliberately marked **ASSUMPTION — VALIDATE**. They must not be treated as production facts, customer commitments, or final storefront copy. Replace each assumption only after a CAD review, slicer estimate, supplier quote, or physical prototype test provides evidence.

## Shared product rules

- Visual direction: warm minimal, calm geometry, no licensed characters, logos, trademarks, or third-party brand shapes.
- Intended manufacturing process: FDM printing unless prototype testing identifies a better process.
- Default material: **ASSUMPTION — VALIDATE:** matte PLA suitable for indoor decorative and organizational use.
- Alternative material: **ASSUMPTION — VALIDATE:** PETG only when additional heat, impact, or moisture resistance is needed.
- Default color direction: warm white, sand, stone, muted clay, charcoal.
- Color availability is subject to actual filament sourcing and must be confirmed before quoting.
- Dimensions are not final until a CAD model is checked against the selected printer bed and a physical fit test is completed.
- All exposed edges must be safe to handle and free from sharp burrs, strings, or support scars.
- Product pages must not claim food safety, dishwasher safety, heat resistance, UV resistance, waterproofing, or cosmetic-chemical resistance without material-specific evidence.

---

# 1. Dune Cosmetic Organizer

## Product intent

A premium-looking countertop organizer for everyday cosmetics and small vanity items, using soft dune-like curves and restrained compartment geometry.

## Target buyer

- A buyer who wants a calmer, more coherent vanity or bathroom counter.
- A buyer who values appearance and tactile quality as much as storage.
- A buyer looking for a made-to-order alternative to generic acrylic organizers.

## Primary use cases

- Organizing lipstick, mascara, brushes, pencils, compact cosmetics, and small skincare containers.
- Creating a defined everyday-routine zone on a vanity or shelf.
- Gifting a personalized organizer in a selected color and size.

## Default dimensions

**ASSUMPTION — VALIDATE:** define after measuring a representative set of cosmetic items and checking the selected printer bed.

Required CAD parameters:

- overall width;
- overall depth;
- overall height;
- number and internal size of upright compartments;
- number and internal size of shallow trays;
- base thickness;
- wall thickness;
- corner radius;
- optional label or monogram zone.

## Adjustable dimensions

- overall width and depth within printer-bed limits;
- compartment count;
- compartment diameter or rectangular width;
- compartment depth;
- tray width;
- optional monogram or short name placement.

Customization must preserve minimum wall thickness, stable center of gravity, printable overhangs, and cleaning access.

## Material assumption

**ASSUMPTION — VALIDATE:** matte PLA for the first visual prototype. Test PETG only if bathroom humidity or cosmetic spills expose a real durability need.

## Color options

Initial palette direction:

- warm white;
- sand;
- stone;
- muted clay;
- charcoal.

Each color requires a real filament sample before being represented as exact storefront photography.

## Model source / modeling approach

- Create an original parametric CAD model.
- Build the body from simple rounded volumes and smooth transitions.
- Avoid copying recognizable commercial organizer silhouettes.
- Keep compartment geometry editable through named parameters.

## Printer bed requirements

**ASSUMPTION — VALIDATE:** the default version should fit on the selected printer in one piece. If not, reduce the default footprint before considering seams or multi-part assembly.

## Estimated filament weight

**ASSUMPTION — VALIDATE IN SLICER.**

Record for each prototype:

- filament type;
- filament brand;
- slicer profile;
- infill percentage;
- wall count;
- top/bottom layers;
- estimated grams;
- actual grams where measurable.

## Estimated print time

**ASSUMPTION — VALIDATE IN SLICER.**

Record standard-quality and high-quality estimates separately. Do not publish print time to buyers.

## Support requirements

Design target: no supports for the main body.

**ASSUMPTION — VALIDATE:** compartment transitions and decorative curves must remain within support-free overhang limits for the selected layer height and nozzle.

## Minimum wall thickness

**ASSUMPTION — VALIDATE:** determine from nozzle size, wall count, drop resistance, and surface-quality tests. Store the final value as a named CAD parameter.

## Finishing steps

1. Remove brim or skirt residue if used.
2. Remove strings and visible artifacts.
3. Deburr all hand-contact edges.
4. Inspect compartment interiors for snags.
5. Clean without adding coatings or chemicals that lack documented compatibility.
6. Photograph only the accepted prototype representing the quoted finish.

## Packaging dimensions

**ASSUMPTION — VALIDATE AFTER PROTOTYPE.**

Package must protect thin compartment walls and curved exterior surfaces. Record product dimensions, protective clearance, final box dimensions, and packed weight.

## Delivery risks

- Tall or narrow compartments may crack during transport.
- Light colors may reveal layer inconsistencies or handling marks.
- Cosmetic residue may stain some matte materials.
- Personalized versions cannot be restocked easily after production.

## Expected price range

**ASSUMPTION — VALIDATE IN ISSUE #25.**

No price should be committed until material, machine time, failure allowance, labor, packaging, fees, tax assumptions, and target margin are calculated.

## Main production risks

- Poor fit for real cosmetic item sizes.
- Warping across a wide base.
- Visible seam or surface defects on premium-facing curves.
- Compartments that are difficult to clean.
- Excessive print time for the achievable selling price.

## Prototype acceptance criteria

- Organizer sits flat without rocking.
- No sharp edges, support scars, or loose strings remain.
- Representative lipstick, mascara, brush, pencil, compact, and small bottle samples fit without forced insertion.
- Items can be removed without adjacent items falling over.
- The organizer does not tip during normal one-handed use.
- Interior compartments are accessible for cleaning.
- The final CAD file uses named parameters for adjustable dimensions.
- Slicer weight and time are recorded.
- Actual prototype dimensions and deviations are recorded.
- Packaging trial shows no visible damage after a representative handling test.

---

# 2. Modular Desk Organizer

## Product intent

A configurable desk organization system with visually consistent modules that can be used alone or combined without looking like temporary utility bins.

## Target buyer

- Home-office and studio users who want flexible organization.
- Buyers who expect their desk accessories to match a minimal interior.
- Buyers whose storage needs may grow over time.

## Primary use cases

- Holding pens, pencils, scissors, rulers, cables, cards, notes, and small desk tools.
- Combining two or more modules into a coherent desktop layout.
- Ordering selected modules in a matching color.

## Default dimensions

**ASSUMPTION — VALIDATE:** define a shared module grid only after measuring representative desk items and checking printer-bed utilization.

Required CAD parameters:

- module grid width and depth;
- module heights;
- connector or alignment feature dimensions;
- wall and base thickness;
- corner radius;
- internal clearances;
- optional cable-pass dimensions.

## Adjustable dimensions

- module width in grid increments;
- module depth in grid increments;
- cup or tray height;
- internal divider position;
- cable-pass inclusion;
- optional label or monogram area.

Changes must remain compatible with the shared alignment system.

## Material assumption

**ASSUMPTION — VALIDATE:** matte PLA for first prototypes. Test PETG only for modules exposed to impact, heat, or repeated flexing.

## Color options

- warm white;
- sand;
- stone;
- muted clay;
- charcoal.

Mixed-color sets may be offered only after real samples confirm the palette works under the same lighting.

## Model source / modeling approach

- Create an original parametric module family.
- Use one shared grid and one consistent corner language.
- Prefer passive alignment geometry over magnets for the first version.
- Do not add magnets until retention, polarity, sourcing, safety, assembly labor, and packaging implications are tested.

## Printer bed requirements

**ASSUMPTION — VALIDATE:** every default module should print individually on the selected printer with efficient bed use. A starter set does not need to print in one batch.

## Estimated filament weight

**ASSUMPTION — VALIDATE IN SLICER** for each module and for the default starter set.

## Estimated print time

**ASSUMPTION — VALIDATE IN SLICER** for each module and for the default starter set.

## Support requirements

Design target: no supports for standard modules.

Cable passes, undercuts, and alignment features must be tested for support-free printing or redesigned.

## Minimum wall thickness

**ASSUMPTION — VALIDATE:** determine through flex, drop, and connector-wear tests. Use one documented shared minimum unless a specific module requires reinforcement.

## Finishing steps

1. Remove brim residue and strings.
2. Deburr module bases and alignment features.
3. Test every module on a flat surface.
4. Test compatibility with at least two other modules.
5. Inspect internal corners for debris traps.
6. Pack modules so their visible faces cannot rub together.

## Packaging dimensions

**ASSUMPTION — VALIDATE AFTER STARTER-SET PROTOTYPE.**

Document both single-module and starter-set packaging. Prevent module-to-module abrasion and movement.

## Delivery risks

- Thin alignment features may break.
- Tolerances may vary across printers or filament batches.
- Large sets may become heavy or expensive to ship.
- Buyers may assume future modules will always remain compatible.

## Expected price range

**ASSUMPTION — VALIDATE IN ISSUE #25.**

Calculate per-module cost and a starter-set bundle without using an unverified discount.

## Main production risks

- Alignment features that are too loose or too tight.
- Inconsistent dimensions across module variants.
- Print time growing faster than perceived buyer value.
- Visible variation when modules are printed in separate batches.
- A module grid that does not fit common desk objects.

## Prototype acceptance criteria

- Every module sits flat and does not rock.
- Modules align consistently in all intended orientations.
- Alignment features survive repeated assembly and separation without visible cracking.
- Representative pens, pencils, scissors, ruler, cards, notes, and cable samples fit their intended modules.
- Removing one item does not pull adjacent modules apart during normal use.
- Standard modules print without supports.
- Named CAD parameters control the grid and major dimensions.
- Slicer weight and time are recorded per module and per starter set.
- Packaging trial prevents visible rubbing and broken alignment features.

---

# 3. Ridge Tray

## Product intent

A shallow presentation and catch-all tray with a refined raised ridge or rhythmic surface detail, suitable for small personal and desk objects.

## Target buyer

- Buyers looking for a minimal entryway, bedside, vanity, or desk tray.
- Buyers who value a decorative object that still has a clear everyday purpose.
- Gift buyers seeking a simple personalized item.

## Primary use cases

- Holding keys, jewelry, watch, earbuds, coins, stationery, or small cosmetic items.
- Creating a defined surface for everyday carry items.
- Serving as a visual companion to the other VITAO products.

## Default dimensions

**ASSUMPTION — VALIDATE:** determine after testing representative object groupings and printer-bed fit.

Required CAD parameters:

- overall width;
- overall depth;
- overall height;
- usable inner area;
- rim height;
- base thickness;
- ridge height, spacing, and radius;
- corner radius;
- optional personalization zone.

## Adjustable dimensions

- overall width and depth within bed limits;
- rim height;
- ridge density;
- personalization text or monogram;
- optional shallow divided zone, provided it remains easy to clean.

## Material assumption

**ASSUMPTION — VALIDATE:** matte PLA for initial visual and handling prototypes.

The tray must not be marketed for direct food contact unless a separate compliant material and process are established.

## Color options

- warm white;
- sand;
- stone;
- muted clay;
- charcoal.

## Model source / modeling approach

- Create an original parametric CAD model.
- Use a simple tray body with a controlled ridge pattern.
- Keep the ridge decorative but easy to print and clean.
- Avoid textures copied from recognizable branded products.

## Printer bed requirements

**ASSUMPTION — VALIDATE:** default tray must fit flat on the selected printer bed with sufficient adhesion margin.

## Estimated filament weight

**ASSUMPTION — VALIDATE IN SLICER.**

## Estimated print time

**ASSUMPTION — VALIDATE IN SLICER.**

Compare at least one standard and one premium-surface profile.

## Support requirements

Design target: no supports.

The rim and ridge geometry must avoid unsupported underside features.

## Minimum wall thickness

**ASSUMPTION — VALIDATE:** determine from base flatness, flex, impact, and finish tests. The base must not feel flimsy or visibly transmit minor surface irregularities.

## Finishing steps

1. Remove brim or edge residue.
2. Deburr the outer rim and personalization.
3. Inspect the full top surface under angled light.
4. Confirm the tray sits flat.
5. Clean without unverified coatings.
6. Add protective wrapping that does not mark the textured surface.

## Packaging dimensions

**ASSUMPTION — VALIDATE AFTER PROTOTYPE.**

Packaging must prevent corner impacts, rim deformation, and abrasion across the decorative surface.

## Delivery risks

- A broad flat base may warp.
- Surface lines may be highly visible under angled light.
- Raised ridges may chip if too thin.
- Buyers may incorrectly assume heat or food resistance.

## Expected price range

**ASSUMPTION — VALIDATE IN ISSUE #25.**

Validate whether the perceived premium finish supports the required margin after accounting for surface-quality print time and rejects.

## Main production risks

- Warping or rocking.
- Ridge detail that traps dust or is difficult to clean.
- Premium-facing surface defects.
- Personalization reducing readability or weakening the base.
- Product appearing too lightweight for the intended price point.

## Prototype acceptance criteria

- Tray sits flat without rocking.
- Rim and ridges have no sharp or fragile edges.
- Representative keys, watch, jewelry, earbuds, coins, and small desk items fit without unstable stacking.
- Objects can be lifted without catching on the ridge pattern.
- Surface can be wiped with a soft damp cloth without inaccessible debris traps.
- Standard model prints without supports.
- Named CAD parameters control major dimensions and ridge geometry.
- Slicer weight and time are recorded.
- Actual flatness and dimensional deviation are recorded.
- Packaging trial shows no corner, rim, or surface damage.

---

# Prototype evidence record

Complete one record per physical prototype.

| Field | Value |
| --- | --- |
| Product and version | |
| CAD file / commit | |
| Printer model | |
| Nozzle | |
| Material and brand | |
| Color | |
| Layer height | |
| Walls | |
| Infill | |
| Supports | |
| Slicer-estimated weight | |
| Actual weight | |
| Slicer-estimated time | |
| Actual print time | |
| Final dimensions | |
| Dimensional deviations | |
| Failed-print observations | |
| Finishing time | |
| Packaging dimensions | |
| Packed weight | |
| Acceptance result | pass / fail |
| Required CAD changes | |

# Definition of ready for Issue #25

The pricing and margin worksheet may replace assumptions with evidence only when, for each product:

- a versioned CAD model exists;
- slicer weight and time are recorded;
- the selected material and filament price source are recorded;
- finishing steps and measured labor time are recorded;
- packaging type, dimensions, and cost source are recorded;
- failed-print allowance is based on an explicit assumption or observed prototype history;
- prototype acceptance status is recorded.
