# VITAO pricing and margin worksheet

Status: planning worksheet for Issue #25. All production inputs remain **UNKNOWN** until measured from a physical prototype, slicer output, supplier quote, utility tariff, or confirmed tax/accounting guidance. The worksheet must not be used as a production claim until the evidence fields are completed.

## Decision rule

A product is **GO** only when:

1. every required input has a recorded source and date;
2. prototype print time and material use are measured rather than estimated;
3. gross margin is at or above the confirmed target threshold;
4. print time is at or below the confirmed maximum acceptable print time;
5. the price is commercially acceptable after taxes, fees, packaging, failure allowance, and any delivery subsidy.

Until the owner confirms a target margin, use `TARGET_MARGIN = UNKNOWN` and return `PENDING`, not GO.

## Shared inputs

| Input | Symbol | Unit | Current value | Evidence required |
|---|---:|---:|---|---|
| Filament purchase price | `FILAMENT_PRICE` | PLN/kg | **UNKNOWN** | Supplier invoice or current quote |
| Electricity tariff | `ELECTRICITY_RATE` | PLN/kWh | **UNKNOWN** | Current electricity bill/tariff |
| Printer average power | `PRINTER_POWER` | kW | **UNKNOWN** | Metered average during representative print |
| Machine purchase cost | `MACHINE_COST` | PLN | **UNKNOWN** | Invoice |
| Depreciation lifetime | `MACHINE_HOURS` | print hours | **ASSUMPTION — confirm** | Owner/accounting decision |
| Failed-print allowance | `FAILURE_RATE` | % | **UNKNOWN** | Measured production history |
| Post-processing labor rate | `LABOR_RATE` | PLN/hour | **UNKNOWN** | Owner decision |
| Packaging cost | `PACKAGING_COST` | PLN/order | **UNKNOWN** | Supplier quote/test order |
| Delivery subsidy | `DELIVERY_SUBSIDY` | PLN/order | **UNKNOWN** | Shipping policy and carrier quote |
| Marketplace/payment fee | `FEE_RATE` | % of selling price | **UNKNOWN** | Platform/payment provider schedule |
| Fixed transaction fee | `FIXED_FEE` | PLN/order | **UNKNOWN** | Platform/payment provider schedule |
| Tax/VAT allowance | `TAX_RATE` | % of selling price | **UNKNOWN** | Accountant-confirmed treatment |
| Target gross margin | `TARGET_MARGIN` | % | **UNKNOWN** | Owner decision |

## Per-product measured inputs

Complete one row for each prototype. Do not substitute catalog copy or unverified slicer estimates for measurements.

| Product | Material weight `W` (g) | Print time `T` (h) | Post-processing `L` (h) | Product-specific packaging (PLN) | Maximum acceptable print time (h) | Evidence |
|---|---:|---:|---:|---:|---:|---|
| Dune Cosmetic Organizer | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | Prototype/slicer record required |
| Modular Desk Organizer | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | Prototype/slicer record required |
| Ridge Tray | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | **UNKNOWN** | Prototype/slicer record required |

## Calculation formulas

Use decimal rates, for example 20% as `0.20`.

```text
material_cost = (W / 1000) * FILAMENT_PRICE

electricity_cost = T * PRINTER_POWER * ELECTRICITY_RATE

machine_depreciation = T * (MACHINE_COST / MACHINE_HOURS)

post_processing_labor = L * LABOR_RATE

base_production_cost =
  material_cost
  + electricity_cost
  + machine_depreciation
  + post_processing_labor
  + PACKAGING_COST
  + product_specific_packaging
  + DELIVERY_SUBSIDY

failed_print_allowance = base_production_cost * FAILURE_RATE

variable_fee = selling_price * FEE_RATE

tax_allowance = selling_price * TAX_RATE

total_cost =
  base_production_cost
  + failed_print_allowance
  + variable_fee
  + FIXED_FEE
  + tax_allowance

gross_profit = selling_price - total_cost

gross_margin = gross_profit / selling_price
```

Because marketplace fees and tax allowances depend on selling price, the minimum price for a target gross margin is:

```text
minimum_price =
  (base_production_cost + failed_print_allowance + FIXED_FEE)
  /
  (1 - FEE_RATE - TAX_RATE - TARGET_MARGIN)
```

The denominator must be greater than zero. Otherwise the selected assumptions cannot produce the requested margin.

## Spreadsheet-friendly worksheet

Copy this table into a spreadsheet. Formula cells are shown symbolically so no unverified number is presented as fact.

| Product | Material cost | Electricity | Depreciation | Labor | Packaging | Delivery subsidy | Failure allowance | Selling price | Fees | Tax allowance | Total cost | Gross profit | Gross margin | Time gate | Margin gate | Decision |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| Dune Cosmetic Organizer | formula | formula | formula | formula | formula | formula | formula | **UNKNOWN** | formula | formula | formula | formula | formula | `T <= max time` | `margin >= target` | **PENDING** |
| Modular Desk Organizer | formula | formula | formula | formula | formula | formula | formula | **UNKNOWN** | formula | formula | formula | formula | formula | `T <= max time` | `margin >= target` | **PENDING** |
| Ridge Tray | formula | formula | formula | formula | formula | formula | formula | **UNKNOWN** | formula | formula | formula | formula | formula | `T <= max time` | `margin >= target` | **PENDING** |

## Example calculation templates

These are complete calculation paths, not numeric production estimates.

### Dune Cosmetic Organizer

```text
material_cost = (DUNE_W / 1000) * FILAMENT_PRICE
electricity_cost = DUNE_T * PRINTER_POWER * ELECTRICITY_RATE
depreciation = DUNE_T * (MACHINE_COST / MACHINE_HOURS)
labor = DUNE_L * LABOR_RATE
base_cost = material_cost + electricity_cost + depreciation + labor
          + PACKAGING_COST + DUNE_PACKAGING + DELIVERY_SUBSIDY
failure_allowance = base_cost * FAILURE_RATE
minimum_price = (base_cost + failure_allowance + FIXED_FEE)
                / (1 - FEE_RATE - TAX_RATE - TARGET_MARGIN)
decision = GO only when measured DUNE_T <= confirmed maximum time
           and calculated margin >= TARGET_MARGIN; otherwise NO-GO or PENDING
```

### Modular Desk Organizer

```text
material_cost = (DESK_W / 1000) * FILAMENT_PRICE
electricity_cost = DESK_T * PRINTER_POWER * ELECTRICITY_RATE
depreciation = DESK_T * (MACHINE_COST / MACHINE_HOURS)
labor = DESK_L * LABOR_RATE
base_cost = material_cost + electricity_cost + depreciation + labor
          + PACKAGING_COST + DESK_PACKAGING + DELIVERY_SUBSIDY
failure_allowance = base_cost * FAILURE_RATE
minimum_price = (base_cost + failure_allowance + FIXED_FEE)
                / (1 - FEE_RATE - TAX_RATE - TARGET_MARGIN)
decision = GO only when measured DESK_T <= confirmed maximum time
           and calculated margin >= TARGET_MARGIN; otherwise NO-GO or PENDING
```

### Ridge Tray

```text
material_cost = (RIDGE_W / 1000) * FILAMENT_PRICE
electricity_cost = RIDGE_T * PRINTER_POWER * ELECTRICITY_RATE
depreciation = RIDGE_T * (MACHINE_COST / MACHINE_HOURS)
labor = RIDGE_L * LABOR_RATE
base_cost = material_cost + electricity_cost + depreciation + labor
          + PACKAGING_COST + RIDGE_PACKAGING + DELIVERY_SUBSIDY
failure_allowance = base_cost * FAILURE_RATE
minimum_price = (base_cost + failure_allowance + FIXED_FEE)
                / (1 - FEE_RATE - TAX_RATE - TARGET_MARGIN)
decision = GO only when measured RIDGE_T <= confirmed maximum time
           and calculated margin >= TARGET_MARGIN; otherwise NO-GO or PENDING
```

## Evidence record

For every value replace `UNKNOWN` only after recording:

- source or measurement method;
- date collected;
- prototype/model revision;
- slicer profile and printer used, where relevant;
- person who confirmed the value;
- notes on uncertainty or expected variation.

## Manual quoting workflow

1. Select the product and current model revision.
2. Enter measured material weight, print time, labor time, and packaging cost.
3. Load current shared cost, fee, tax, and margin assumptions.
4. Calculate the minimum viable price.
5. Compare the proposed quote with the minimum price and print-time gate.
6. Return `PENDING` whenever a required input is unknown; do not replace missing data with an invented estimate.
7. Record the quote assumptions so the result can be reproduced later.
