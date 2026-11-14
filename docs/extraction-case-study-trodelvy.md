# Case study: Trodelvy 55135-0132-01 and the gaps in reconstitution extraction

2026-11-12. Starting point: the package page showed one reconstitution row (180 mg, 20 mL NS,
no final volume, no concentration) above a "Resolved volume: Unresolved" line.

## What the label says

Description section:

> Reconstitution with 20 mL of 0.9% Sodium Chloride Injection, USP, results in a concentration
> of 10 mg/mL with a pH of 6.5.

Dosage and Administration section:

> Using a sterile syringe, slowly inject 20 mL of 0.9% Sodium Chloride Injection, USP, into each
> 180 mg TRODELVY vial. Each vial contains overfill … the total resulting volume delivers a
> concentration of 10 mg/mL.

The label states the answer twice. The extractor got neither.

## Why it failed (`src/lib/labels/dry-fill-volume.ts`)

| # | Miss | Where | Status |
|---|------|-------|--------|
| 1 | The words that introduce the yield included "resulting in" but not "results in" | `YIELD` | **Fixed** |
| 2 | A concentration followed by "with a pH of …" was rejected: the lookahead allowed only `and`, punctuation, or end of sentence | `CONCENTRATION` | **Fixed** |
| 3 | "inject 20 mL … into each 180 mg vial": no `with`, and no `reconstitut…` verb governing the volume | `DILUENT`, `GOVERNING_VERB` | Open |
| 4 | The fallback (`withLabelConcentrations`) did find 10 mg/mL elsewhere, but rejected it on physics: 180 mg ÷ 10 mg/mL = 18 mL, which is less than the 20 mL of diluent. The vial is overfilled, and the label says so. | `withLabelConcentrations` | Open |

After fixes 1 and 2 this package resolves to 18 mL at 10 mg/mL, with 20 mL of diluent. The
regression test is in `reconstitution.test.ts`. Final volume < diluent is correct here: 18 mL
is the deliverable volume. Powder displacement clamps to 0, and the diagram shows a smaller
final volume than diluent added. Overfill needs its own representation (see below).

Its stored snapshot does not change until the package is refetched
(`scripts/refetch-incomplete.ts --ndcs=55135013201`).

## How widespread: unresolved dry-fill packages

Taken from the latest catalog-enrichment snapshots, 2026-11-12:

- 742 dry-fill packages; 127 have a resolved volume with no final volume; 53 have no resolved volume at all.
- Of the 127, **117 have no reconstitution row at all**, and 9 have only a diluent row (Trodelvy's symptom).

I re-fetched the openFDA label (by SPL set id) for the 180 unresolved packages: 99 distinct
labels. I ran only the prose parser over them; the SPL table parser was not run, so tables may
already cover some of these.

- 11 now yield rows, but only 1 yields a final volume.
- 50 have a candidate sentence (reconstitution plus a mL volume) and produce no row.
- 37 have no such sentence; their label states no reconstitution, or states it some other way.

## Recurring phrasings that produce no row

Ordered by how many labels they would unlock.

1. **An adverb between "by" and "adding"**: "Reconstitute … vials by *aseptically* adding 5 mL
   of …". This covers every micafungin label (~10). `DILUENT` accepts `by adding` but not
   `by <adverb> adding`. Cheap fix: allow one `-ly` word.
2. **Imperative verbs other than reconstitute**: "Add 5 mL Sterile Water … to the 250 mg and
   500 mg vials" and "dissolve in 3.5 or 6.8 mL …" (ampicillin, ~8 labels). Trodelvy's "inject
   20 mL … into each 180 mg vial" is the same pattern. `GOVERNING_VERB` requires the nearest
   verb to be `reconstitut…`. Admit `add|inject|dissolve` when the destination is a vial
   (`to|into (the|each) N mg vial`) and the sentence is not about a bag or infusion. Bags are
   the risk: "Add the appropriate volume … into 100 mL of 0.9% Sodium Chloride" must stay out.
   The destination noun (vial vs. bag/solution) is the guard.
3. **Tables flattened into text**: the ceftriaxone 250/350 mg/mL matrix, vancomycin's
   "Concentration/Vial | Volume of Diluent", and amoxicillin's bottle/water tables appear in
   openFDA as run-on sentences. These belong to the table parser. Trodelvy's snapshot has
   `splXml: null`, so for packages without SPL XML only openFDA's `*_table` fields can supply
   them. Next step: check whether these unresolved packages lack `splXml` and whether their
   `*_table` fields are read.
4. **Overfill**: when the label uses "overfill", a stated concentration whose implied volume is
   *below* the diluent volume should be accepted rather than rejected. The resolved volume
   should then read "deliverable", not "final". `overfill.ts` already has the
   `OVERFILL` test to reuse.

## Process lessons

- **Measure on the unresolved set, not on fixtures.** Each regex was right for the label it
  was written from. The gaps appear only when the extractor runs across every unresolved
  package. Make the re-extraction harness used here a script: for unresolved snapshots,
  re-fetch by set id, run the extractors, and print each candidate sentence that produced no
  row. Rerun it after every parser change, and report the movement.
- **Note which half failed.** Here the row parser and the fallback both reached the correct
  number and each threw it away for a different reason. A debug trace per package ("row
  parsed, concentration dropped by lookahead; fallback found 10 mg/mL, rejected by
  physics") would have pinpointed this in one look.
- **The UI hides failures.** "Unresolved" with dashes looked like duplicated data. Showing
  the reason (miss 4 above, or "diluent only, no yield stated") in place of the dashes turns
  every unresolved package into a bug report.
