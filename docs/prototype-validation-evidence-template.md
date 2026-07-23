# Prototype validation evidence template

Use this template for each physical prototype evaluated under Issue #29.

This document is an evidence-capture structure only. It does not prove that a prototype was produced, measured, tested, or approved. Replace every `TBD` with directly observed evidence and attach source files where available.

## 1. Prototype identity

- Product name: `TBD`
- Repository product/spec reference: `TBD`
- Prototype version or file revision: `TBD`
- Production method: `TBD`
- Produced internally or outsourced: `TBD`
- Production date: `TBD`
- Evidence owner: `TBD`
- Evidence location (photos, source files, receipts): `TBD`

## 2. Measurement conditions

Record the tools and conditions so later measurements can be compared consistently.

- Measuring tool: `TBD`
- Tool resolution or tolerance: `TBD`
- Scale used for weight: `TBD`
- Environmental or setup notes: `TBD`
- Number of repeated measurements: `TBD`

Do not infer precision beyond the measuring equipment used.

## 3. Physical dimensions

| Measurement | Repository or buyer-facing claim | Measured value | Difference | Evidence reference | Status |
| --- | --- | --- | --- | --- | --- |
| Width | `TBD` | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Depth | `TBD` | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Height | `TBD` | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Other critical dimension | `TBD` | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |

Notes:

- Record the actual measured object, not only slicer or CAD values.
- If a dimension varies across the object, record the measurement points.
- Buyer-facing dimensions must remain qualified as assumptions until supported by evidence.

## 4. Production evidence

| Item | Planned or assumed value | Observed value | Evidence reference | Status |
| --- | --- | --- | --- | --- |
| Material type | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Material used | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Print or production time | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Failed attempts | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Post-processing time | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |
| Packaging time | `TBD` | `TBD` | `TBD` | Confirmed / Correct / Qualify |

Do not convert estimates into production claims. Keep slicer estimates separate from measured material and elapsed production time.

## 5. Quality inspection

Rate each item with direct observations and evidence.

| Check | Result | Observation | Evidence reference |
| --- | --- | --- | --- |
| Dimensional consistency | Pass / Fail / Not tested | `TBD` | `TBD` |
| Stability on intended surface | Pass / Fail / Not tested | `TBD` | `TBD` |
| Sharp edges or unsafe points | Pass / Fail / Not tested | `TBD` | `TBD` |
| Visible layer or surface defects | Pass / Fail / Not tested | `TBD` | `TBD` |
| Warping or deformation | Pass / Fail / Not tested | `TBD` | `TBD` |
| Moving or removable parts | Pass / Fail / Not applicable / Not tested | `TBD` | `TBD` |
| Expected load or fit | Pass / Fail / Not tested | `TBD` | `TBD` |
| Cleaning and routine handling | Pass / Fail / Not tested | `TBD` | `TBD` |

Do not claim food, medical, child, heat, chemical, or other regulated safety suitability without separate verified requirements and evidence.

## 6. Buyer-use test

- Intended buyer use checked: `TBD`
- Test scenario: `TBD`
- Items used during the test: `TBD`
- Observed usability problems: `TBD`
- Observed comprehension problems: `TBD`
- Test duration: `TBD`
- Evidence reference: `TBD`

Only record observed behavior. Do not invent customer feedback or treat an internal opinion as market validation.

## 7. Packaging and delivery risks

| Risk | Observation or test | Result | Mitigation or follow-up |
| --- | --- | --- | --- |
| Breakage | `TBD` | `TBD` | `TBD` |
| Deformation | `TBD` | `TBD` | `TBD` |
| Surface damage | `TBD` | `TBD` | `TBD` |
| Excess packaging size | `TBD` | `TBD` | `TBD` |
| Assembly or loose parts | `TBD` | `TBD` | `TBD` |
| Other | `TBD` | `TBD` | `TBD` |

Do not claim nationwide delivery readiness until packaging and delivery risks have been tested or explicitly recorded as unresolved.

## 8. Claim reconciliation

List every affected buyer-facing statement from the website, listing drafts, specifications, or pricing documents.

| Source file or page | Current claim | Evidence result | Required action | Follow-up issue or PR |
| --- | --- | --- | --- | --- |
| `TBD` | `TBD` | Confirmed / Contradicted / Not tested | Keep / Correct / Qualify / Remove | `TBD` |

Rules:

- Do not silently edit buyer-facing facts without traceability.
- Create or update a narrowly scoped issue for required corrections.
- Preserve PL/EN consistency for every buyer-facing correction.
- Keep prices in zł unless a separately approved decision changes them.

## 9. Cost and margin inputs

Record evidence for later pricing work without treating the result as a validated market price.

- Material cost evidence: `TBD`
- Outsourcing or machine cost evidence: `TBD`
- Labour or handling time evidence: `TBD`
- Packaging cost evidence: `TBD`
- Failed-print allowance evidence: `TBD`
- Other direct cost evidence: `TBD`
- Pricing worksheet reference: `TBD`

## 10. Decision

Choose exactly one outcome.

- [ ] **GO** — evidence supports proceeding to the next validation step.
- [ ] **REWORK** — specific prototype or claim changes are required before further validation.
- [ ] **DROP** — evidence does not justify continuing this product in the current phase.

Decision rationale: `TBD`

Required follow-up actions:

1. `TBD`
2. `TBD`
3. `TBD`

Decision owner: `TBD`

Decision date: `TBD`

## Completion gate

This evidence record is complete only when:

- physical evidence references are available;
- measured values are distinguished from CAD, slicer, supplier, or repository assumptions;
- production time and material use are observed or explicitly marked unverified;
- quality and intended-use checks contain observations;
- packaging and delivery risks are recorded;
- affected buyer-facing claims are traced to a keep, correct, qualify, or remove action;
- a GO, REWORK, or DROP decision has an evidence-based rationale;
- no unverified fact is presented as measured or customer-validated.
