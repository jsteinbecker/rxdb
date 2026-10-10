# Formulary item brand-name tags

## Goal
Each formulary item (a concept or NDC load) carries a set of brand-name tags, editable on the item detail page
(`/formulary/items/[id]`). Loading an item seeds the tags with every brand reachable from its related SBDs (SBD → BN).

## Decisions
- **Dismissals persist.** Removing a seeded (RxNorm) tag marks it suppressed; later reloads never bring it back.
- **Dedicated table**, not JSON and not the property-override tables (those model one value per property per package).

## Data
`formulary_item_brand`: `id`, `formulary_item_id` (FK), `rxcui` (nullable), `name`, `name_key` (lower-cased, whitespace-collapsed), `source` (`rxnorm` | `manual`),
`suppressed` (bool), `created_at`. Unique on `(formulary_item_id, name_key)` (Prisma can't index `lower(name)`). One Prisma migration.

## Seeding (in `loadToFormulary`'s transaction, after package links)
- Brands come from `concept.details.brands`. For an SCD/GPCK node this already includes the BN of every rolled-up
  SBD/BPCK, so no extra RxNav calls.
- NDC-level loads have no concept; seed from the package brand name when present.
- Pure `mergeBrands(existing, incoming)` returns inserts only: names already present (case-insensitive, any state)
  are untouched, so `suppressed` survives reloads. Brands RxNorm later drops are kept.

## Editing (item page)
- Chips for active tags; RxNorm ones carry a marker. Enter in the input adds a manual tag.
- Adding a name that matches a suppressed row un-suppresses it; matching an active row is a no-op.
- × deletes a manual tag, suppresses an RxNorm tag.
- A "Dismissed (n)" disclosure lists suppressed tags with a restore action (no inline per-row controls).
- Form actions on the item page; item must be in the default scope (404 otherwise). Names are trimmed; blank or
  over 120 characters is rejected with a notice.

## Read side
`itemBrands(db, itemId)` returns active and dismissed tags; the item page load includes them. Nothing else consumes
tags yet.

## Testing
Unit tests on `mergeBrands` and the add/remove transitions (first seed, reload with new brand, reload after
suppression, case-insensitive duplicate). Dev-server check of the page.

## Out of scope
Brand search/filtering, brand tags in package titles, a brand-level view.
