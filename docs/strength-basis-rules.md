# Strength, basis and naming rules

How an imported package's actives are named, measured and displayed. Read this before
changing import, strength correction, titles, ingredient tables, ions or sums. Every rule
here comes from a correction the owner has already had to make at least once.

## 1. Who arbitrates

1. **The RxNorm SCD is the target.** A package's title and strength rows must read like
   its SCD: the same substances, spelled as RxNorm spells them, with the same numbers.
   For example, Zosyn reads `piperacillin 2 g / tazobactam 250 mg`, not
   `piperacillin sodium 60 mg/mL`.
2. **A local superseding concept beats RxNorm** where the owner has made one, because
   RxNorm is known to be stale for that product (TrophAmine). Nothing else beats RxNorm.
3. **The SPL says what the printed number measures.** RxNorm only names moieties and
   numbers. The label's `classCode` tells you whose mass the number is.
4. **The FDA NDC directory is not independent evidence.** Its strengths are derived from
   the same SPL, and it names the salt even where the number is the moiety's. When the
   directory "agrees" with the label, nothing has been proved.

## 2. Reading the basis from the SPL

| classCode | The printed number is the mass of… | Default |
|---|---|---|
| `ACTIB` | the ingredient as named (salt, hydrate and all) | trust it |
| `ACTIM` | the active moiety ("equivalent to X mg of drug") | trust it |
| `ACTIR` | a reference substance | trust it |

- **Default to trusting the code.** `ACTIM` on `CEFIDEROCOL SULFATE TOSYLATE 1 g` means
  1 g of cefiderocol. That is what the label says, and the SCD (`cefiderocol 1000 MG`)
  agrees. The same goes for vancomycin HCl, piperacillin sodium and tazobactam sodium.
- **A bare name is the drug.** `AMOXICILLIN` is amoxicillin, even when its UNII is the
  trihydrate's. Never convert a bare name to an "anhydrous equivalent".
- **Compare names hydrate-blind and anion-blind** (`sameSubstance`): `PIPERACILLIN
  ANHYDROUS` and `piperacillin` are the same substance, and so are `CLAVULANIC ACID`
  and RxNorm's `clavulanate`.
- **Only an SCD/SBD name arbitrates** (`scdStrengths`). RxNav sometimes names an NDC
  in the listing's own words (`Citric Acid Monohydrate 0.80 g in 100 mL`, lowercase
  units). That names the hydrate, not the moiety, and says nothing about the basis.

## 3. When a coded basis may be overridden

Only with evidence. One of these must hold:

- **RxNorm disagrees with the label, and the salt-to-moiety conversion lands on RxNorm's
  number.** This is the light-salt case, ratio 1.005–1.3 (rule 2 in
  `spl-strength-checks.ts`).
- **No SCD states that moiety at the label's number** (heavy salt, rule 3), and the
  label's text doesn't give the number as the moiety's. ACD-A's citric acid
  monohydrate is an example.
- **The SCD states the moiety at the label's number, but the label's own formula line
  gives the salt that mass** ("L-Lysine Acetate USP 1.2 g;"). Only then is RxNorm
  taken to have copied the salt's mass (TrophAmine).

The label text is the SPL XML with its markup stripped, so it is available even when
openFDA has no label. Text that gives the number as the moiety's ("1 gram of
cefiderocol", "equivalent to 125 mg of clavulanic acid") always blocks the
conversion. A strength pair ("Clavulanate Potassium 125 mg/31.25 mg") is a product
title written in the moiety's numbers, so it never counts as salt evidence. A
miscoded denominator (`513 mg in 1 mg`) is a separate, provable error: correct it
to the package unit (rule 1).

## 4. Displayed versus derived values

- **The title and strength rows show the basis substance at the basis amount**: the
  substance whose mass the number actually is, at that number. It is the SCD's
  substance and number wherever one exists.
- **Derived figures never replace a displayed number.** These are moiety equivalents,
  GSRS conversions, ion content, sums and dosing measures. They belong in the
  ingredient table, nested under the row they come from (a `sum` basis, indented
  children with tree lines), and in calculations. Store them next to the printed
  value, never instead of it.
  - ACD-A's title reads `citric acid monohydrate 8 mg/mL`, as printed. The 7.31 mg/mL
    anhydrous equivalent is a derived row. A stored row records which correction
    moved its number (`labelStrength.correction`). For a `moiety-equivalent` (rule 3)
    correction, the title shows `labelStrength.strength` under the salt's own name. A
    `salt-equivalent` (rule 2) correction is the SCD's own number, and it is shown.
- **Labels win over formulas for declared totals.** A per-package statement followed
  by this NDC counts, and so does a per-gram one ("2.84 mEq (65 mg) of sodium per gram
  of piperacillin"), scaled by that drug's grams. When the label total and the
  salt-formula figure disagree by more than 5%, show the label's total and keep the
  formula figure as a note. Zosyn's total includes its citrate buffer, which no active
  salt's formula can see. The formula figure is used when the label declares nothing.
- **Sum only what is meant to be summed.** Sodium citrate is not summed into citric
  acid in ACD. Acetyl-L-tyrosine plus tyrosine sum to total tyrosine in TrophAmine.
  Racemic amphetamine salts break down to dextro- and levo-amphetamine at 3:1, nested
  under their parent.

## 5. Formatting

- Use RxNorm's spelling for every active, and order actives alphabetically as RxNorm does.
- Show container totals when the SCD states amounts (`3 g` for a 50 mL bag). Show
  mg/mL when the SCD states a concentration.
- Write volume denominators per mL. Match significant figures across a title's actives.
- Keep salt words the name needs: `trisodium citrate dihydrate`, never `trisodium`.
- Strength styles override the form for chosen ingredient and dose-form pairs (SWFI as
  `100%`, epinephrine as `1:100,000`, NaCl as `%`). These are display only.

## 6. Import hygiene

- **A fetch that hit errors is not data.** A snapshot with `complete: false` or provider
  errors (openFDA/DailyMed 429) must never replace a complete snapshot. A package whose
  only snapshot failed is "not yet imported", not "has no ingredients".
- **Rate limits are waited out, not recorded.** `rateLimitedFetch` pauses the whole
  host on a 429 (Retry-After, else 2 s doubling up to 60 s) and retries up to 4 times.
  openFDA rotates keys first. Fanning out across hundreds of NDCs with no back-off is
  how 668 amoxicillin packages ended up with no ingredients on 2026-10-18.
- **Refetch one package at a time** through a running dev server:
  `scripts/refetch-incomplete.ts <base> [--empty]` for incomplete snapshots, or
  `--ndcs=a,b` to force specific packages after a rule change (`/api/v1/ndc/<ndc>?refresh=1`).
- An incomplete snapshot with no provider errors and no ingredients is usually a real
  answer: an unlisted NDC with no SPL, which the exclusion ladder drops (`no-spl`).
- **After a rule change, refetch the affected snapshots.** Strength corrections are baked
  into stored snapshots.

## 7. Verifying

```bash
node --env-file=.env --import tsx scripts/audit-scd-strengths.ts /tmp/audit.json
```

This compares every live formulary package's displayed actives with its SCD. Run it
before and after any change in this area. Don't claim a fix until every remaining
disagreement has a reason you can name. Checking one NDC page is not enough.

## Audit, 2026-10-18 (1491 live packages, catalog v34)

| Packages | What is wrong | Rule broken |
|---|---|---|
| 668 | Amoxicillin and amox/clav have no ingredients: the only snapshot hit a 429 storm | §6 |
| 1035 | The latest snapshot is `complete: false` (668 of them empty) | §6 |
| 2 | Fetroja shows `cefiderocol 737.1 mg`; the label and SCD say 1 g. Rule 3 converted it | §2, §3 |
| 1 | The ACD-A title shows converted `anhydrous citric acid 7.314 mg/mL` | §4 |
| 6 | The Zosyn sodium row replaces the label's 5.58/8.38/11.17 mEq with formula values | §4 |
| 13 | Ampicillin pharmacy bulk shows `ampicillin sodium 10 g` (no SPL rows, directory only) | §1 |
| 37 | Glucose SCDs show `dextrose monohydrate` | §1 (open question) |
| 20 | Pip/tazo pharmacy bulk shows `12 g / 1.5 g` where the SCD states 200/25 mg/mL | §5 (open question) |
| 54 | SWFI and bacteriostatic water show `1 mL/mL` | strength style, not basis |

## After the fixes, 2026-10-19 (1294 live packages)

197 packages left the formulary as `no-spl` once they were refetched. 125 disagreements
remain, each with a known reason:

| Packages | What | Status |
|---|---|---|
| 54 | SWFI and bacteriostatic water show `1 mL/mL` | strength style, not basis |
| 37 | Glucose SCDs show `dextrose monohydrate` (the number agrees) | open: SCD name or label name? |
| 33 | Pip/tazo and ampicillin pharmacy bulk show the vial total (`12 g`, `10 g`); the SCD states mg/mL | open: total or SCD concentration for a dry bulk vial? |
| 1 | ACD-A: RxNav's name is a listing, not an SCD | expected; the title follows §4 |

Fixed: amoxicillin's empty snapshots (668), Fetroja (2), amox/clav clavulanate
125→104.9 mg (93), ACD-A's title, and the Zosyn sodium rows (12).
