<script lang="ts">
	import { racemicDisplayName } from '$lib/ingredient-group';
	import RxCui from '$lib/components/RxCui.svelte';
      import type {StagedPackage} from '$lib/server/catalog-sync';
      import type {LabelIngredient} from '$lib/server/catalog-providers';
      import {appearanceText, isSolidDoseForm, SHAPE_CODES} from '$lib/spl-characteristics';
      import {refineAppearances} from '$lib/spl-appearance-text';
      import PillMockup from './PillMockup.svelte';
      import RouteBadge from './RouteBadge.svelte';
      import {drugsComImprint, drugsComImprintUrl, drugsComNdcUrl} from '$lib/drugs-com';
      import {pillImageKey, type PillMedia, type PillPhotoRef, pillPhotoUrl} from '$lib/pill-image-layout';
      import {resolve} from '$app/paths';
      import {constituentName, ionDisplayName} from '$lib/ions';
      import {deserialize} from '$app/forms';
      import {invalidateAll} from '$app/navigation';
      import SplLabelSections from './SplLabelSections.svelte';
      import OverrideCitation from './OverrideCitation.svelte';
      import {nextAddedRowId, overrideTargets, pillIlnKey} from '$lib/property-override-fields';
      import {AMBIGUITY_KINDS} from '$lib/labeler-ambiguity';
      import {pseudoScdFor} from '$lib/pseudo-scd';
      import {withBiosimilarSuffix} from '$lib/biosimilar';
      import {timeReleaseAfterRelease} from '$lib/package-title';
      import {unitOfSaleLabel, unitOfUseLabel} from '$lib/package-unit-label';
      import {toNdc11} from '$lib/ndc';
      import MixedFraction from './MixedFraction.svelte';
      import ReconstitutionDiagram from './ReconstitutionDiagram.svelte';
      import {mgPer, mlPer} from '$lib/units';
      import {isOralDryFillForm} from '$lib/ingredient-content';
      import {fromNumber, toNumber} from '$lib/rational';
      import {
            ingredientCorrectionKey,
            INGREDIENT_CORRECTION_KEY,
            parseIngredientCorrection,
            describeCorrection,
            formatStrength,
            parseStrengthText
      } from '$lib/ingredient-correction';
      import {packageClassKey} from '$lib/pharm-class-key';
      import {scopeOptions} from '$lib/pharm-class-scope-options';

      let {
            item,
            editing = false,
            editKeys = [],
            pillMedia = undefined,
            formularyItems = undefined,
            onretry = undefined,
            onassignclass = undefined,
            onedit,
            oncorrect
      }: {
            item: StagedPackage;
            /**
             * Every formulary item that lists this package, however it was loaded. Without it the
             * row can only say whether the NDC was loaded as an item of its own.
             */
            formularyItems?: { id: string; displayName: string }[];
            /** Fetches the package again; offered where a provider did not answer. */
            onretry?: () => void;
            /** Opens the "Assign class…" dialog from the pharmacologic class menu. */
            onassignclass?: () => void;
            /** Offer a pencil (revealed on hover) beside each overridable property. */
            editing?: boolean;
            /** Keys open in the override panel, to mark their pencil. */
            editKeys?: string[];
            onedit?: (keys: string[]) => void;
            /** Opens the ingredient correction wizard on the ingredient at this index. */
            oncorrect?: (index: number) => void;
            /** Each appearance's photo and measured layout; may still be on its way. */
            pillMedia?: PillMedia | Promise<PillMedia>;
      } = $props();

      const d = $derived(item.details);      // The coded appearances, refined by the label's own prose in How Supplied or DF&S.
      const appearances = $derived(
            refineAppearances(d?.spl?.appearances ?? [], d?.label?.sections, {
                  ndc: item.ndc,
                  strengths: item.ingredients.map((ingredient) => ingredient.strength),
                  doseForm: item.doseForm
            })
      );
      // Before (or without) a lookup, only the photo the snapshot itself names.
      const labelPhotoOf = (appearance: { image?: string | null }): PillPhotoRef | null =>
            item.splSetId && appearance.image ? {setId: item.splSetId, image: appearance.image} : null;
      const pseudoScd = $derived(pseudoScdFor(item));
      // A biosimilar's ingredient carries its FDA suffix even when the source names only the reference.
      const substance = (name: string) =>
            withBiosimilarSuffix(racemicDisplayName(name), [item.genericName, item.splTitle, d?.rxnav?.conceptName]);
      const active = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'active') ?? []);
      const inactive = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'inactive') ?? []);
      const ionic = $derived(d?.spl?.ingredients.filter((i) => i.kind === 'ionic') ?? []);
      // Each ion constituent sits right under the last salt it comes from, so it
      // reads as part of that ingredient rather than as one more ingredient.
      const ingredientRows = $derived.by(() => {
            const placed = new Set<(typeof ionic)[number]>();
            const rows = active.flatMap((ingredient, index) => {
                  const ions = ionic.filter(
                        (ion) =>
                              !placed.has(ion) &&
                              ion.ionicContent?.sourceIngredients.includes(ingredient.name) &&
                              !active
                                    .slice(index + 1)
                                    .some((later) => ion.ionicContent?.sourceIngredients.includes(later.name))
                  );
                  ions.forEach((ion) => placed.add(ion));
                  return [ingredient, ...ions];
            });
            return [...rows, ...ionic.filter((ion) => !placed.has(ion)), ...inactive];
      });
      // Strength corrections, numbered by first appearance so identical notes on
      // several rows (a miscoded denominator shared by every excipient) share a mark.
      const strengthNotes = $derived([
            ...new Set(ingredientRows.flatMap((i) => i.strengthNotes ?? []))
      ]);
      const noteMark = (note: string) => '*'.repeat(strengthNotes.indexOf(note) + 1);
      // Manual ingredient corrections are footnoted like the automatic ones, with
      // their own mark (§) and color so a person's edit reads apart from the rules'.
      const manualCorrections = $derived(
            ingredientRows.flatMap((ingredient) => {
                  const index = d?.spl?.ingredients.indexOf(ingredient) ?? -1;
                  const value = item.propertyOverrides?.[ingredientCorrectionKey(index)]?.value;
                  const correction = value ? parseIngredientCorrection(value) : null;
                  return correction ? [{ingredient, correction}] : [];
            })
      );
      const manualMark = (ingredient: LabelIngredient) =>
            '§'.repeat(manualCorrections.findIndex((c) => c.ingredient === ingredient) + 1);
      const manualNote = ({ingredient, correction}: (typeof manualCorrections)[number]) => {
            const to = formatStrength(correction.strength);
            const as = correction.basis === 'ingredient' ? '' : ` ${correction.moiety?.name.toLowerCase() ?? 'moiety'}`;
            const from = correction.conversion?.original;
            return from
                  ? `Strength manually corrected from stated value of ${from} to ${to}${as}`
                  : `${substance(ingredient.name)} manually corrected to ${to}${as}`;
      };
      // Active ingredients that deliver the same moiety (tyrosine and acetyl
      // tyrosine both supply tyrosine) are grouped, each group given a letter and
      // hue. The total is only stated when every member is measured as that
      // moiety in the same units; an ingredient-basis salt's mass is not the
      // moiety's mass, so it is listed but not added.
      const moietyGroups = $derived.by(() => {
            const byMoiety = new Map<string, { name: string; members: LabelIngredient[] }>();
            for (const ingredient of ingredientRows) {
                  if (ingredient.kind !== 'active') continue;
                  const moiety = ingredient.moieties[0];
                  const unii = moiety?.unii ?? ingredient.unii;
                  if (!unii) continue;
                  const group = byMoiety.get(unii) ?? {name: moiety?.name ?? ingredient.name, members: []};
                  group.members.push(ingredient);
                  byMoiety.set(unii, group);
            }
            return [...byMoiety.entries()]
                  .filter(([, group]) => group.members.length > 1)
                  .map(([unii, group], g) => {
                        const parts = group.members.map((ingredient) => {
                              const asMoiety =
                                    ingredient.basis === 'moiety' || ingredient.unii === unii;
                              return {ingredient, asMoiety, strength: parseStrengthText(ingredient.strength)};
                        });
                        const first = parts[0].strength;
                        const summable = parts.every(
                              (p) =>
                                    p.asMoiety &&
                                    p.strength &&
                                    first &&
                                    p.strength.unit === first.unit &&
                                    p.strength.per === first.per &&
                                    p.strength.perUnit === first.perUnit
                        );
                        const total = summable
                              ? Number(parts.reduce((sum, p) => sum + Number(p.strength!.value), 0).toPrecision(6))
                              : null;
                        return {
                              unii,
                              name: group.name,
                              label: String.fromCharCode(65 + g),
                              hue: (g * 137 + 200) % 360,
                              parts,
                              total: total == null ? null : strengthText(formatStrength({...first!, value: String(total)}))
                        };
                  });
      });
      const moietyGroupOf = (ingredient: LabelIngredient) =>
            moietyGroups.find((group) => group.parts.some((p) => p.ingredient === ingredient));
      const rxnavMarketingStatus = $derived(
            d?.rxnav?.properties.find((property) => property.name === 'MARKETING_STATUS')?.value ?? null
      );
      // RxNav's NDC properties mix RxNorm identifiers with package facts (labeler,
      // marketing, SPL ids) that RxNorm doesn't own; only the former belong in the
      // RxNorm section.
      const RXNORM_PROP = /^(RXCUI|RXAUI|TTY|SAB|CODE|RXNORM_NAME)$/i;
      const rxnormProps = $derived(d?.rxnav?.properties.filter((p) => RXNORM_PROP.test(p.name)) ?? []);
      const otherRxnavProps = $derived(
            d?.rxnav?.properties.filter((p) => !RXNORM_PROP.test(p.name)) ?? []
      );
      // RxNav names its properties in SPL field codes and states shapes and dates as
      // codes; say them in words, keeping the code beside anything translated.
      const RXNAV_LABELS: Record<string, string> = {
            COLORTEXT: 'Color',
            COLOR: 'Color code',
            SHAPE: 'Shape',
            SHAPETEXT: 'Shape',
            SIZE: 'Size',
            SCORE: 'Score',
            IMPRINT_CODE: 'Imprint',
            LABELER: 'Labeler',
            LABEL_TYPE: 'Label type',
            MARKETING_CATEGORY: 'Marketing category',
            MARKETING_STATUS: 'Marketing status',
            MARKETING_EFFECTIVE_TIME_LOW: 'Marketing start',
            MARKETING_EFFECTIVE_TIME_HIGH: 'Marketing end',
            DM_SPL_ID: 'DailyMed SPL ID',
            SPL_SET_ID: 'SPL set ID',
            DCSA: 'DEA schedule',
            ANDA: 'Application',
            NDA: 'Application',
            BLA: 'Application',
            NDA_AUTHORIZED_GENERIC: 'Application'
      };
      const rxnavLabel = (name: string) =>
            RXNAV_LABELS[name] ?? name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ');
      const rxnavValue = (name: string, value: string) => {
            if (/^\d{8}$/.test(value) && /TIME|DATE/.test(name)) return date(value) ?? value;
            if (name === 'SHAPE' && SHAPE_CODES[value]) return `${SHAPE_CODES[value].toLowerCase()} (${value})`;
            if (name === 'IMPRINT_CODE') return value.split(';').join(' / ');
            if (name === 'SCORE') return value === '1' ? 'none (1 piece)' : `${value} pieces`;
            return value;
      };
      const formatNdc = (ndc: string) => `${ndc.slice(0, 5)}-${ndc.slice(5, 9)}-${ndc.slice(9)}`;
      // The 10-digit form the FDA lists, from the product code's segment widths (4-4-2, 5-3-2, 5-4-1).
      const fdaNdc = $derived.by(() => {
            const code = item.productCode;
            if (!code || !/^\d+-\d+$/.test(code)) return null;
            const pkg = code.replace('-', '').length === 9 ? item.ndc.slice(-1) : item.ndc.slice(-2);
            return `${code}-${pkg}`;
      });
      const flag = (value: boolean | null, yes: string, no: string) =>
            value === true ? yes : value === false ? no : 'Unknown';
      const date = (value: string | null | undefined) =>
            value && /^\d{8}$/.test(value)
                  ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
                  : (value ?? null);
      // A declared end date inside this window warns before it excludes.
      const DISCONTINUING_DAYS = 90;
      const discontinuing = $derived.by(() => {
            const end = item.marketingEndDate;
            if (item.exclusionReason || !end || !/^\d{8}$/.test(end)) return null;
            const endMs = Date.UTC(+end.slice(0, 4), +end.slice(4, 6) - 1, +end.slice(6));
            const days = Math.ceil((endMs - Date.now()) / 86_400_000);
            return days >= 0 && days <= DISCONTINUING_DAYS ? {date: date(end), days} : null;
      });
      const volume = $derived(item.resolvedVolume);
      // What the diagram needs beyond the resolved volume: the default row's
      // diluent and vial content, and the package volume when the label showed
      // it to be the vial's capacity rather than a fill.
      const diagram = $derived.by(() => {
            if (!volume) return null;
            const row = item.reconstitution.find((step) => step.id && step.id === volume.rowId) ??
                  (item.reconstitution.length === 1 ? item.reconstitution[0] : null);
            const size = item.size;
            const sizeMl = size?.kind === 'volume' ? size.value * (mlPer(size.unit) ?? NaN) : NaN;
            const sizeMg = size?.kind === 'mass' ? size.value * (mgPer(size.unit) ?? NaN) : NaN;
            return {
                  diluentName: row?.diluents?.join(' or ') ?? null,
                  contentMg: row?.vialMassMg ?? (Number.isFinite(sizeMg) ? sizeMg : null),
                  capacityMl: volume.meaning === 'capacity' && Number.isFinite(sizeMl) ? sizeMl : null
            };
      });
      // A kit is sold as the kit; the unit of use is its drug bottle.
      const kit = $derived(item.kit ?? null);
      const kitPartText = (part: NonNullable<typeof kit>['parts'][number]) =>
            [
                  part.amount !== null ? `${part.amount} ${part.unit ?? ''}`.trim() : null,
                  (part.container ?? 'part').toLowerCase(),
                  '—',
                  part.name?.toLowerCase() ?? 'unnamed part',
                  part.doseForm ? `(${part.doseForm.toLowerCase()})` : null,
                  part.role === 'diluent' ? '· drug-free diluent' : null
            ]
                  .filter(Boolean)
                  .join(' ');
      // Fills an unstated final volume or concentration from the row's other stated
      // values (mass ÷ concentration, mass ÷ volume). Only with a single stated
      // concentration: a combination vial's mass can't be split between ingredients.
      // The fraction a stored decimal stands in for (131.578947… is 131 11/19), or
      // null when no small fraction reproduces it and the decimal should show.
      const asFraction = (value: number) => {
            const r = fromNumber(value, 1000);
            return r && Math.abs(toNumber(r) - value) <= 1e-9 * Math.max(1, Math.abs(value)) ? r : null;
      };
      const round = (value: number) => Math.round(value * 100) / 100;
      // A label's "/1" (per tablet, per vial) adds nothing a reader needs.
      const strengthText = (strength: string) => strength.replace(/\s*\/\s*1$/, '');
      const calculated = (step: StagedPackage['reconstitution'][number]) => {
            const mass = step.vialMassMg;
            const stated = step.concentrations.length === 1 ? step.concentrations[0].mgPerMl : null;
            return {
                  finalVolumeMl:
                        step.finalVolumeMl == null && mass != null && stated ? mass / stated : null,
                  mgPerMl:
                        !step.concentrations.length && mass != null && step.finalVolumeMl
                              ? mass / step.finalVolumeMl
                              : null
            };
      };
      // Corrections are cited like footnotes too: a mark beside the corrected value,
      // with the original and the evidence in a footer.
      const corrections = $derived(
            [
                  item.unitOfUseCorrection && {
                        id: 'uou',
                        mark: '†',
                        text: item.unitOfUseCorrection.note,
                        original: item.unitOfUseCorrection.from,
                        evidence: []
                  },
                  item.doseFormCorrection && {
                        id: 'dose-form',
                        mark: '‡',
                        text: `Dose form corrected from stated value of ${item.doseFormCorrection.from}`,
                        original: null,
                        evidence: item.doseFormCorrection.evidence
                  }
            ].filter((c) => !!c)
      );
      const correction = (id: string) => corrections.find((c) => c.id === id);
      const overrideFields = $derived(overrideTargets(item));
      // Manual overrides are cited like footnotes: a numbered mark beside each
      // overridden value, with the sourcing listed in a footer at the end.
      const uid = $props.id();
      const overrides = $derived(Object.entries(item.propertyOverrides ?? {}));
      const citeNumber = (key: string) => overrides.findIndex(([k]) => k === key) + 1;
      // Manual citations are lettered (a, b, … z, aa) so they stand apart from the
      // numbered provider sources.
      const citeLetter = (n: number) => {
            let letters = '';
            for (; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(97 + ((n - 1) % 26)) + letters;
            return letters;
      };
      // Every other fact cites the provider it came from, numbered in a Sources footer.
      type SourceId = 'ndc' | 'spl' | 'label' | 'rxnav' | 'catalog';
      const sources = $derived(
            [
                  (d?.product || d?.packaging || item.listed !== null) && {
                        id: 'ndc' as const,
                        name: 'FDA NDC Directory (openFDA)',
                        url: item.productCode
                              ? `https://api.fda.gov/drug/ndc.json?search=product_ndc:"${item.productCode}"`
                              : null,
                        detail: [
                              item.listed === true ? 'exact NDC listed' : item.listed === false ? 'NDC not listed' : null,
                              d?.product?.splId ? `SPL document ${d.product.splId}` : null
                        ]
                  },
                  item.splSetId && {
                        id: 'spl' as const,
                        name: `DailyMed SPL — ${item.splTitle ?? item.splSetId}`,
                        url: `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.splSetId}`,
                        detail: [
                              `set ${item.splSetId}`,
                              d?.spl?.version ? `v${d.spl.version}` : null,
                              d?.spl?.publishedDate ? `published ${d.spl.publishedDate}` : null,
                              d?.spl?.siblingNdc ? `via sibling NDC ${d.spl.siblingNdc}` : null
                        ]
                  },
                  d?.label && {
                        id: 'label' as const,
                        name: 'openFDA drug label',
                        url: d.label.setId
                              ? `https://api.fda.gov/drug/label.json?search=set_id:"${d.label.setId}"`
                              : null,
                        detail: [
                              d.label.effectiveTime ? `effective ${date(d.label.effectiveTime)}` : null,
                              d.label.version ? `v${d.label.version}` : null
                        ]
                  },
                  d?.rxnav && {
                        id: 'rxnav' as const,
                        name: 'RxNav (NLM RxNorm)',
                        url: `https://mor.nlm.nih.gov/RxNav/search?searchBy=NDC&searchTerm=${item.ndc}`,
                        detail: [d.rxnav.rxcui ? `RxCUI ${d.rxnav.rxcui}` : null, d.rxnav.status]
                  },
                  {
                        id: 'catalog' as const,
                        name: 'Catalog derivation',
                        url: null,
                        detail: ['computed by this catalog from the sources above']
                  }
            ].filter((source) => !!source)
      );
      // Why a package counts as incomplete, in the terms of the rule that decides it.
      const incompleteReasons = $derived(
            [
                  item.listed === null && 'the FDA NDC Directory has no entry for this exact package',
                  item.splPresent === null && 'DailyMed did not say whether it has a label',
                  !d?.label && 'no openFDA label came back',
                  !d?.rxnav && 'RxNav did not answer'
            ].filter((reason) => !!reason)
      );
      const sourceNumber = (id: SourceId) => sources.findIndex((source) => source.id === id) + 1;
      const splIndex = (ingredient: LabelIngredient) => d?.spl?.ingredients.indexOf(ingredient) ?? -1;
      // One reconstitution row's actions menu open at a time.
      let rowMenu = $state<string | null>(null);
      // Every value cites its provider; the marks show on hover, or all at once on request.
      let showSources = $state(false);
      const openFromMenu = (keys: string[]) => {
            rowMenu = null;
            onedit?.(keys);
      };

      // Classes the source gave that a rule removed, and which shown classes a rule added.
      const classSource = $derived(d?.product?.pharmClassResolution?.source);
      /** Assigning needs an ingredient set to key the rule on. */
      const canAssignClass = $derived(!!onassignclass && scopeOptions(packageClassKey(item)).length > 0);
      const hiddenClasses = $derived(
            (classSource ?? []).filter((name) => !d?.product?.pharmClasses.includes(name))
      );
      const isRuleClass = (name: string) => !!classSource && !classSource.includes(name);

      let deletingKey = $state<string | null>(null);
      let deleteMessage = $state('');

      /** Deletes a manual override and its citation, restoring the provider value. */
      async function deleteOverride(key: string, label: string) {
            if (!confirm(`Delete the override and citation for ${label}? The provider value will be restored.`))
                  return;
            deletingKey = key;
            deleteMessage = '';
            const form = new FormData();
            form.set('key', key);
            try {
                  const result = deserialize(
                        await (await fetch('?/removeOverride', {method: 'POST', body: form})).text()
                  );
                  if (result.type === 'success') await invalidateAll();
                  else
                        deleteMessage =
                              result.type === 'failure'
                                    ? String(result.data?.message ?? 'Could not delete override.')
                                    : 'Could not delete override.';
            } catch {
                  deleteMessage = 'Could not delete override.';
            } finally {
                  deletingKey = null;
            }
      }
</script>

<svelte:window
      onclick={(event) => {
		if (rowMenu && !(event.target as Element).closest('.row-menu, .row-menu-trigger'))
			rowMenu = null;
	}}
      onkeydown={(event) => {
		if (event.key === 'Escape') rowMenu = null;
	}}
/>

{#snippet correctionMark(id: string)}
      {@const c = correction(id)}
      {#if c}<sup class="cite"><a href={`#${uid}-${c.id}-note`} title={c.text}>[{c.mark}]</a></sup>{/if}
{/snippet}
{#snippet cite(keys: string[])}
      {#each keys.map(citeNumber).filter((n) => n > 0) as n (n)}<sup class="cite manual"
      ><a href={`#${uid}-override-${n}`} title="Manually overridden — see manual citations"
      >[{citeLetter(n)}]</a
      ></sup
      >{/each}
{/snippet}
{#snippet overrideValue(key: string, value: string, label: string)}
      {@const correction = INGREDIENT_CORRECTION_KEY.test(key) ? parseIngredientCorrection(value) : null}
      {#if correction}
            {describeCorrection(correction, label.replace(/: ingredient correction$/, ''))}
            {#if correction.conversion}
                  {@const c = correction.conversion}
                  <span class="conversion"
                  >converted from {c.original} × {Number(c.factor).toPrecision(4)} (MW {c.from.mw.toFixed(2)} → {c.to.mw.toFixed(2)}{c.n !== 1 ? `, n = ${c.n}` : ''}; {c.gsrsFetchedAt && !c.mwEdited
                        ? `GSRS, ${c.gsrsFetchedAt.slice(0, 10)}`
                        : 'MW entered by hand'})</span
                  >
            {/if}
      {:else}{value}{/if}
{/snippet}
{#snippet src(id: SourceId)}
      {@const n = sourceNumber(id)}
      {#if n}<sup class="cite source"
      ><a href={`#${uid}-source-${n}`} title={sources[n - 1].name}>[{n}]</a></sup
      >{/if}
{/snippet}

{#snippet edit(keys: string[], label: string, source: SourceId | null = null)}
      {#if keys.some((key) => citeNumber(key) > 0)}{@render cite(keys)}{:else if source}{@render src(
            source
      )}{/if}{@render editButton(keys, label)}
{/snippet}

{#snippet deleteButton(key: string, label: string)}
      {#if editing}
            <button
                  class="delete"
                  type="button"
                  disabled={deletingKey !== null}
                  title={`Delete the override and citation for ${label}`}
                  aria-label={`Delete the override and citation for ${label}`}
                  onclick={() => deleteOverride(key, label)}
            >{deletingKey === key ? 'Deleting…' : 'Delete'}</button>
      {/if}
{/snippet}

{#snippet editButton(keys: string[], label: string)}
      {@const available = keys.filter((key) => overrideFields.some((field) => field.key === key))}
      {#if editing && available.length}
            <button
                  class="edit"
                  class:active={available.every((key) => editKeys.includes(key))}
                  type="button"
                  title={`Override ${label}`}
                  aria-label={`Override ${label}`}
                  onclick={() => onedit?.(available)}
            >
                  <svg viewBox="0 0 16 16" aria-hidden="true"
                  >
                        <path
                              d="M11.2 2.3a1.4 1.4 0 0 1 2 0l.5.5a1.4 1.4 0 0 1 0 2L6 12.5l-3 .8.8-3z"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.3"
                              stroke-linejoin="round"
                        />
                        <path d="M10 3.5 12.5 6" stroke="currentColor" stroke-width="1.3"/>
                  </svg
                  >
            </button
            >
      {/if}
{/snippet}

{#snippet ok(good: boolean | null | undefined)}
	{#if good}<span class="ok" aria-label="OK">✓</span>{/if}
{/snippet}

{#snippet qty(value: number, unit: string)}
	{@const r = asFraction(value)}
	{#if r}<MixedFraction value={r} {unit}/>{:else}{round(value)} {unit}{/if}
{/snippet}

{#snippet calcChip(value: number, unit: string, formula: string)}
	<span class="calc-chip" title={`Not stated on the label. ${formula}`}
      ><svg viewBox="0 0 16 16" aria-hidden="true"
      ><rect
            x="3"
            y="1.5"
            width="10"
            height="13"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
      /><rect x="5" y="3.5" width="6" height="2.5" rx="0.4" fill="currentColor"/><circle
            cx="5.75"
            cy="8.5"
            r="0.8"
            fill="currentColor"
      /><circle cx="8" cy="8.5" r="0.8" fill="currentColor"/><circle
            cx="10.25"
            cy="8.5"
            r="0.8"
            fill="currentColor"
      /><circle cx="5.75" cy="11.5" r="0.8" fill="currentColor"/><circle
            cx="8"
            cy="11.5"
            r="0.8"
            fill="currentColor"
      /><circle cx="10.25" cy="11.5" r="0.8" fill="currentColor"/></svg
      ><span class="sr-only">Calculated:</span>{@render qty(value, unit)}</span
      >
{/snippet}

<div class="detail" class:show-sources={showSources}>
      {#if item.providerErrors?.length}
            <p class="wide provider-errors" role="status">
                  <b>Incomplete:</b>
                  {#each item.providerErrors as failure, i (failure.source)}{i ? '; ' : ''}{failure.source}
                        {failure.message}{failure.status === 429 && failure.source === 'openFDA'
                              ? ' (set OPENFDA_API_KEY for a higher quota)'
                              : ''}{/each}. Values from {item.providerErrors.length === 1 ? 'it' : 'them'}
                  are missing or kept from an earlier fetch.
            </p>
      {:else if !item.complete}
            <p class="muted wide provider-errors" role="status">
                  <b>Incomplete:</b>
                  {incompleteReasons.length
                        ? incompleteReasons.join('; ')
                        : 'some providers did not answer'}, so some values may be missing.
                  {#if onretry}<button class="link-button" type="button" onclick={onretry}>Fetch again</button>{/if}
            </p>
      {/if}
      <!-- What the package looks like comes first: it is how a pharmacist confirms they hold the right one. -->
      {#if appearances.length}
      <section class="wide identification">
            <h4>Appearance{@render edit(
                  appearances.flatMap((_, i) => [
                        ...['colors', 'shape', 'sizeMm', 'score', 'profile', 'imprint'].map(
                              (field) => `details.spl.appearances.${i}.${field}`
                        ),
                        pillIlnKey(i)
                  ]),
                  'pill appearance',
                  'spl'
            )}</h4>
            <div class="appearance-grid">
                  {#if isSolidDoseForm(item.doseForm)}
                        {#await pillMedia}
                              {#each appearances as appearance, i (appearance.productCode ?? i)}
                                    <figure class="appearance-card">
                                          <PillMockup {appearance} doseForm={item.doseForm}/>
                                          <figcaption>{appearanceText(appearance)}</figcaption>
                                    </figure>
                              {/each}
                        {:then media}
                              {#each appearances as appearance, i (appearance.productCode ?? i)}
                                    {@const photo = media?.photos[i] ?? labelPhotoOf(appearance)}
                                    <figure class="appearance-card">
                                          <PillMockup
                                                {appearance}
                                                doseForm={item.doseForm}
                                                layout={photo
                                                      ? (media?.layouts[pillImageKey(photo.setId, photo.image)] ?? null)
                                                      : null}
                                                photoUrl={photo ? pillPhotoUrl(photo) : null}
                                          />
                                          <figcaption>{appearanceText(appearance)}</figcaption>
                                    </figure>
                              {/each}
                        {:catch}
                              {#each appearances as appearance, i (appearance.productCode ?? i)}
                                    {@const photo = labelPhotoOf(appearance)}
                                    <figure class="appearance-card">
                                          <PillMockup
                                                {appearance}
                                                doseForm={item.doseForm}
                                                photoUrl={photo ? pillPhotoUrl(photo) : null}
                                          />
                                          <figcaption>{appearanceText(appearance)}</figcaption>
                                    </figure>
                              {/each}
                        {/await}
                  {:else}
                        {#each appearances as appearance, i (appearance.productCode ?? i)}
                              <figure class="appearance-card text-only">
                                    <figcaption>{appearanceText(appearance)}</figcaption>
                              </figure>
                        {/each}
                  {/if}
            </div>
            {#if drugsComNdcUrl(item.ndc)}
                  <p class="pill-links">
                        <span class="pill-links-label">Look up on Drugs.com</span>
                        <a href={drugsComNdcUrl(item.ndc)} target="_blank" rel="noopener noreferrer">This NDC</a>
                        {#each [...new Set(appearances
                              .map((a) => drugsComImprint(a.imprint))
                              .filter((x) => !!x))] as imprint (imprint)}
                              <a href={drugsComImprintUrl(imprint)} target="_blank" rel="noopener noreferrer"
                              >Imprint “{imprint}”</a>
                        {/each}
                  </p>
            {/if}
      </section>
      {/if}

      <section>
            <h4>Package</h4>
            <dl>
                  <dt>NDC</dt>
                  <dd>
                        <span class="mono">{formatNdc(item.ndc)}</span>
                  </dd>
                  <dt>Product NDC</dt>
                  <dd>
                        <span class="mono">{item.productCode ?? '—'}</span>{@render edit(['productCode'], 'product NDC', 'ndc')}
                  </dd>
                  <dt>Description</dt>
                  <dd>
                        {item.description ?? '—'}{@render edit(['description'], 'description', 'ndc')}
                        {@render correctionMark('uou')}
                  </dd>
                  <dt>Brand</dt>
                  <dd>{item.brandName ?? '—'}{@render edit(['brandName'], 'brand name', 'ndc')}</dd>
                  <dt>Generic</dt>
                  <dd>{item.genericName ?? '—'}{@render edit(['genericName'], 'generic name', 'ndc')}</dd>
                  <dt>Labeler</dt>
                  <dd>
                        <a href={resolve('/formulary/labeler/[code]', { code: item.ndc.slice(0, 5) })}>{item.labelerName ?? '—'}</a>
                        <span class="mono">({item.labelerCode ?? '?'})</span>{@render edit(['labelerName', 'labelerCode'], 'labeler', 'ndc')}
                  </dd>
                  <dt>Dose form</dt>
                  <dd>
                        {item.doseForm ?? '—'}{@render edit(['doseForm'], 'dose form', 'ndc')}
                        {#if item.doseFormCorrection}
                              {@render correctionMark('dose-form')}
                        {/if}
                  </dd>
                  <dt>Routes</dt>
                  <dd>
                        {#each d?.product?.routes ?? [] as route (route)}
                              <RouteBadge {route}/>
                        {:else}—
                        {/each}{@render src('ndc')}
                  </dd>
                  {#if d?.product?.manufacturers.length}
                        <dt>Manufacturers</dt>
                        <dd>{d.product.manufacturers.join('; ')}{@render src('ndc')}</dd>
                  {/if}
                  <dt>Finished product</dt>
                  <dd>{flag(d?.product?.finished ?? null, 'Finished', 'Unfinished')}{@render src('ndc')}</dd>
                  {#if item.size}
                        <dt>Unit of sale</dt>
                        <dd>
                              {kit && !kit.partOf?.length ? '1 kit' : unitOfSaleLabel(item.size)}{@render edit(['size.packQty', 'size.value'], 'unit of sale', 'catalog')}
                        </dd>
                        <dt>Unit of use</dt>
                        <dd>
                              {unitOfUseLabel(item.size)}{@render edit(['size.value', 'size.container', 'size.unit'], 'unit of use', 'catalog')}
                              {@render correctionMark('uou')}
                        </dd>
                  {/if}
                  {#if kit}
                        <dt>{kit.partOf?.length ? 'Kit part' : 'Kit contents'}</dt>
                        <dd>
                              {#each kit.parts as part, i (i)}
                                    <div>{kitPartText(part)}</div>
                              {/each}
                              {#if kit.partOf?.length}
                                    <div class="muted">
                                          Sold only inside kit
                                          {#each kit.partOf as code, i (code)}{i ? ', ' : ''}<a
                                                href={resolve('/formulary/ndc/[ndc]', { ndc: toNdc11(code) ?? code })}>{code}</a
                                          >{/each}
                                    </div>
                              {/if}
                              {#if kit.selectedBy === 'how-supplied'}
                                    <div class="muted">
                                          The label lists parts for several kit sizes; this NDC's were matched from How
                                          Supplied.
                                    </div>
                              {:else if kit.selectedBy === 'ambiguous'}
                                    <div class="muted">
                                          The label lists parts for several kit sizes, and nothing tells this NDC's
                                          apart.
                                    </div>
                              {/if}{@render src('spl')}
                        </dd>
                  {/if}
                  {#if !isSolidDoseForm(item.doseForm)}
                        <dt>Multi-dose</dt>
                        <dd>
                              {flag(item.isMultiDose, 'Multi-dose', 'Single-dose')}{@render edit(['isMultiDose'], 'multi-dose', 'catalog')}
                        </dd>
                        <dt>Dry fill</dt>
                        <dd>
                              {item.isDryFill ? 'Yes — reconstitute before use' : 'No'}{@render edit(['isDryFill'], 'dry fill', 'catalog')}
                        </dd>
                  {/if}
            </dl>
      </section>

      <section>
            <h4>Status and regulatory</h4>
            <dl>
                  <dt>FDA NDC directory</dt>
                  <dd>
                        {@render ok(item.listed === true)}{item.listed === true
                              ? 'Exact NDC found'
                              : item.listed === false
                                    ? 'No exact NDC entry found'
                                    : 'Unknown'}{#if item.listed !== true && d?.product}
                              <span class="muted">· product found via {d.packaging?.siblings.length
                                    ? `sibling NDC${d.packaging.siblings.length === 1 ? '' : 's'} ${d.packaging.siblings.map((s) => s.ndc).join(', ')}`
                                    : `product code ${item.productCode ?? item.ndc.slice(0, 9)}`}</span>
                        {/if}{@render edit(['listed'], 'FDA NDC directory', 'ndc')}
                  </dd>
                  <dt>DailyMed SPL</dt>
                  <dd>
                        {@render ok(item.splPresent === true || Boolean(d?.spl?.siblingNdc))}{d?.spl?.siblingNdc && item.splPresent !== true
                              ? `Found via sibling NDC ${d.spl.siblingNdc}`
                              : flag(item.splPresent, 'Found', 'Not found')}{@render edit(['splPresent'], 'DailyMed SPL', 'spl')}
                  </dd>
                  <dt>Catalog eligibility</dt>
                  <dd class:bad={item.exclusionReason} class:warn={discontinuing}>
                        {@render ok(!item.exclusionReason && !discontinuing)}{item.exclusionReason === 'manual' ? `Excluded: ${item.manualExclusion}` : (item.exclusionReason ?? 'Eligible')}
                        {#if discontinuing}
                              · discontinuing {discontinuing.date} ({discontinuing.days} day{discontinuing.days === 1
                              ? ''
                              : 's'})
                        {/if}{@render src('catalog')}
                  </dd>
                  <dt>Formulary</dt>
                  <dd>
                        {#if formularyItems}
                              {@render ok(formularyItems.length > 0)}{#if formularyItems.length}On formulary as
                                    {#each formularyItems as formularyItem, index (formularyItem.id)}{index ? ', ' : ''}<a
                                          href={resolve('/formulary/items/[id]', {id: formularyItem.id})}
                                    >{formularyItem.displayName}</a>{/each}{:else}Not on formulary{/if}
                        {:else}
                              {@render ok(item.loaded)}{item.loaded ? 'Loaded as its own item' : 'Not loaded as its own item'}
                        {/if}{@render src('catalog')}
                  </dd>
                  {#if item.splInactivated != null}
                        <dt>SPL inactivated</dt>
                        <dd>{@render ok(item.splInactivated === false)}{item.splInactivated ? 'Yes' : 'No'}{@render src('spl')}</dd>
                  {/if}
                  <dt>RxNav NDC status</dt>
                  <dd>{@render ok(item.rxcuiStatus?.toUpperCase() === 'ACTIVE')}{item.rxcuiStatus ?? '—'}{@render edit(['rxcuiStatus'], 'RxNav NDC status', 'rxnav')}</dd>
                  <dt>RxNav marketing status</dt>
                  <dd>{@render ok(rxnavMarketingStatus?.toUpperCase() === 'ACTIVE')}{rxnavMarketingStatus ?? '—'}{@render src('rxnav')}</dd>
                  <dt>Species</dt>
                  <dd>
                        {flag(item.isVeterinary, 'Veterinary', 'Human')}{@render edit(['isVeterinary'], 'species', 'ndc')}
                  </dd>
                  <dt>Product type</dt>
                  <dd>
                        {d?.product?.productType ?? '—'}{@render edit(['details.product.productType'], 'product type', 'ndc')}
                  </dd>
                  <dt>Marketing category</dt>
                  <dd>
                        {d?.product?.marketingCategory ?? '—'}{@render edit(['details.product.marketingCategory'], 'marketing category', 'ndc')}
                  </dd>
                  <dt>Application</dt>
                  <dd>
                        <span class="mono">{d?.product?.applicationNumber ?? '—'}</span>{@render edit(['details.product.applicationNumber'], 'application', 'ndc')}
                  </dd>
                  <dt>DEA schedule</dt>
                  <dd>
                        {d?.product?.deaSchedule ?? 'None'}{@render edit(['details.product.deaSchedule'], 'DEA schedule', 'ndc')}
                  </dd>
                  <dt>Marketing</dt>
                  <dd>
                        {date(d?.packaging?.marketingStartDate ?? d?.product?.marketingStartDate) ?? '?'} →
                        {date(item.marketingEndDate) ?? 'present'}{@render edit(['marketingEndDate'], 'marketing end date', 'ndc')}
                  </dd>
                  <dt>Listing expires</dt>
                  <dd>{date(d?.product?.listingExpirationDate) ?? '—'}{@render src('ndc')}</dd>
                  <dt>Sample</dt>
                  <dd>
                        {d?.packaging?.sample === true ? 'Yes' : d?.packaging?.sample === false ? 'No' : '—'}{@render src('ndc')}
                  </dd>
                  {#if d?.product?.rxcuis.length}
                        <dt>openFDA RxCUIs</dt>
                        <dd>{#each d.product.rxcuis as id, i (id)}{i ? '; ' : ''}<RxCui rxcui={id} />{/each}{@render src('ndc')}</dd>
                  {/if}
                  {#if d?.product?.uniis.length}
                        <dt>UNIIs</dt>
                        <dd class="mono">
                              {#each d.product.uniis as unii, i (unii)}{i ? ', ' : ''}<a
                                    href={resolve('/formulary/unii/[unii]', { unii })}>{unii}</a
                              >{/each}{@render src('ndc')}
                        </dd>
                  {/if}
            </dl>
      </section>

      {#if d?.product?.pharmClasses.length || hiddenClasses.length || canAssignClass || d?.packaging?.siblings.length}
            <div class="stack">
            {#if d?.product?.pharmClasses.length || hiddenClasses.length || canAssignClass}
                  <section>
                        <div class="pharm-head">
                              <h4>Pharmacologic class{@render src('ndc')}</h4>
                              {#if canAssignClass}
                                    <div class="pharm-menu">
                                          <button
                                                class="row-menu-trigger"
                                                type="button"
                                                aria-label="Pharmacologic class actions"
                                                aria-haspopup="menu"
                                                aria-expanded={rowMenu === 'pharm-class'}
                                                onclick={() => (rowMenu = rowMenu === 'pharm-class' ? null : 'pharm-class')}>
                                                ⋯
                                          </button>
                                          {#if rowMenu === 'pharm-class'}
                                                <div class="row-menu" role="menu">
                                                      <button
                                                            type="button"
                                                            role="menuitem"
                                                            onclick={() => {
                                                                  rowMenu = null;
                                                                  onassignclass?.();
                                                            }}>Assign class…
                                                      </button>
                                                </div>
                                          {/if}
                                    </div>
                              {/if}
                        </div>
                        {#if !d?.product?.pharmClasses.length && !hiddenClasses.length}
                              <p class="pharm-empty">No pharmacologic class</p>
                        {/if}
                        <div class="pharm-classes">
                              {#each d?.product?.pharmClasses ?? [] as pharmClass, i (i)}
                                    {@const classType = /\[(.*)]$/.exec(pharmClass)?.[1] ?? ''}
                                    <div class="pharm-class">
                                          {#if classType}<span class="class-type mono">{classType}</span>{/if}
                                          <span>{pharmClass.replace(/\s*\[.*]$/, '')}</span>
                                          {#if isRuleClass(pharmClass)}<span class="class-tag" title="Added by a pharmacologic class rule">rule</span>{/if}
                                          {#if !/\[(?:EPC|MoA|PE|CS)]$/.test(pharmClass)}<span class="class-tag" title="Not an openFDA class">custom</span>{/if}
                                    </div>
                              {/each}
                        </div>
                        {#if hiddenClasses.length}
                              <details class="hidden-classes">
                                    <summary>Hidden by rule ({hiddenClasses.length})</summary>
                                    <ul>
                                          {#each hiddenClasses as pharmClass (pharmClass)}<li>{pharmClass}</li>{/each}
                                    </ul>
                              </details>
                        {/if}
                  </section>
            {/if}

            {#if d?.packaging?.siblings.length}
                  <section>
                        <h4>Sibling packages{@render src('ndc')}</h4>
                        <div class="table-wrap mini-wrap">
                              <table class="data-table mini-table">
                                    <thead>
                                    <tr>
                                          <th scope="col">Pkg</th>
                                          <th scope="col">Description</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {#each [...d.packaging.siblings, {
                                          ndc: item.ndc,
                                          description: item.description
                                    }].sort((a, b) => a.ndc.localeCompare(b.ndc)) as sibling (sibling.ndc)}
                                          {@const current = sibling.ndc === item.ndc}
                                          <tr class:current>
                                                <td>
                                                      {#if current}
      										<span class="mono sib-code disabled" aria-current="page"
                                                                        title="This package"
                                                                  >-{sibling.ndc.slice(-2)}</span
                                                                  >
                                                      {:else}
                                                            <a
                                                                  class="mono sib-code"
                                                                  href={resolve('/formulary/ndc/[ndc]', { ndc: sibling.ndc })}
                                                            >-{sibling.ndc.slice(-2)}</a
                                                            >
                                                      {/if}
                                                </td>
                                                <td>
                                                      {(sibling.description ?? '')
                                                            .replace(/\s*\(\d{4,5}-\d{3,4}-\d{1,2}\)\s*/g, ' ')
                                                            .replace(/\s+/g, ' ')
                                                            .trim()}
                                                </td>
                                          </tr>
                                    {/each}
                                    </tbody>
                              </table>
                        </div>
                  </section>
            {/if}
            </div>
      {/if}

      <!-- A tablet or capsule has nothing to reconstitute; offer the section only to forms that might. -->
      {#if volume || item.reconstitution.length || (editing && !isSolidDoseForm(item.doseForm))}
            <section class="wide">
                  <h4>Reconstitution, concentration and volume{@render src('spl')}</h4>
                  {#if volume}
                        <p class="resolved-summary">
                              <strong>Resolved volume:</strong>
                              {#if volume.finalVolumeMl === null}Unresolved{:else}{@render qty(volume.finalVolumeMl, 'mL')} final{/if}{@render edit(
                              ['resolvedVolume.finalVolumeMl'],
                              'resolved volume'
                        )}
                              {#if volume.concentrationMgPerMl !== null || editing}
                                    · <strong>Resolved concentration:</strong>
                                    {#if volume.concentrationMgPerMl === null}— mg/mL{:else}{@render qty(volume.concentrationMgPerMl, 'mg/mL')}{/if}{@render edit(
                                    ['resolvedVolume.concentrationMgPerMl'],
                                    'resolved concentration'
                              )}{/if}
                              {#if volume.diluentMl !== null || editing}
                                    · <strong>Diluent added:</strong>
                                    {#if volume.diluentMl === null}— mL{:else}{@render qty(volume.diluentMl, 'mL')}{/if}{@render edit(
                                    ['resolvedVolume.diluentMl'],
                                    'diluent added'
                              )}{/if}
                              {#if volume.powderDisplacementMl != null || (volume.finalVolumeMl != null && volume.diluentMl != null) || editing}
                                    · <strong>Powder displacement:</strong>
                                    {@const displacement = volume.powderDisplacementMl ??
                                    (volume.finalVolumeMl != null && volume.diluentMl != null
                                          ? Math.max(0, volume.finalVolumeMl - volume.diluentMl)
                                          : null)}
                                    {#if displacement === null}— mL{:else}{@render qty(displacement, 'mL')}{/if}{@render edit(
                                    ['resolvedVolume.powderDisplacementMl'],
                                    'powder displacement'
                              )}{/if}
                        </p>
                        {#if diagram}
                              <ReconstitutionDiagram
                                    finalVolumeMl={volume.finalVolumeMl}
                                    diluentMl={volume.diluentMl}
                                    powderDisplacementMl={volume.powderDisplacementMl}
                                    concentrationMgPerMl={volume.concentrationMgPerMl}
                                    diluentName={diagram.diluentName}
                                    contentMg={diagram.contentMg}
                                    capacityMl={diagram.capacityMl}
                                    container={isOralDryFillForm(item.doseForm) ? 'bottle' : 'vial'}
                              />
                        {/if}
                        <p class="muted">
                              Package volume meaning: {volume.meaning}.{@render edit(
                              ['resolvedVolume.meaning'],
                              'package volume meaning'
                        )}
                        </p>
                  {/if}
                  {#if item.reconstitution.length}
                        <div class="table-wrap">
                              <table class="data-table">
                                    <thead
                                    >
                                    <tr
                                    >
                                          <th>Route</th>
                                          <th>Vial content</th>
                                          <th>Diluent to add</th>
                                          <th>Diluent</th>
                                          <th
                                          >Stated final volume
                                          </th
                                          >
                                          <th>Stated concentration</th>
                                          {#if editing}
                                                <th
                                                ><span class="visually-hidden">Row actions</span></th
                                                >
                                          {/if}
                                    </tr
                                    >
                                    </thead
                                    >
                                    <tbody>
                                    {#each item.reconstitution as step, i (i)}
                                          {@const calc = calculated(step)}
                                          {@const rowKey = `reconstitution.${step.id ?? i}`}
                                          <tr>
                                                <td
                                                >{step.routes?.join(', ') ?? 'Not stated'}{@render edit(
                                                      [`${rowKey}.routes`],
                                                      'routes'
                                                )}
                                                      {#if step.id && step.id === volume?.rowId}
                                                            <span class="muted">(default)</span>{/if}
                                                </td
                                                >
                                                <td
                                                >{#if step.vialMassMg === null}Not stated{:else}{@render qty(step.vialMassMg, 'mg')}{/if}{@render edit(
                                                      [`${rowKey}.vialMassMg`],
                                                      'vial content'
                                                )}</td
                                                >
                                                <td
                                                >{@render qty(step.diluentMl, 'mL')}{@render edit(
                                                      [`${rowKey}.diluentMl`],
                                                      'diluent to add'
                                                )}</td
                                                >
                                                <td
                                                >{step.diluents?.join(' or ') ?? 'Not stated'}{@render edit(
                                                      [`${rowKey}.diluents`],
                                                      'diluent'
                                                )}</td
                                                >
                                                <td
                                                >
                                                      {#if step.finalVolumeMl != null}{@render qty(step.finalVolumeMl, 'mL')}
                                                      {:else if calc.finalVolumeMl != null}{@render calcChip(
                                                            calc.finalVolumeMl, 'mL',
                                                            `Calculated: ${step.vialMassMg} mg ÷ ${step.concentrations[0].mgPerMl} mg/mL`
                                                      )}{:else}Not stated
                                                      {/if}{@render edit(
                                                      [`${rowKey}.finalVolumeMl`],
                                                      'final volume'
                                                )}</td
                                                >
                                                <td
                                                >
                                                      {#each step.concentrations as concentration, c (c)}
                                                            <div>
                                                                  {@render qty(concentration.mgPerMl, 'mg/mL')}{concentration.name
                                                                  ? ` ${concentration.name.toLowerCase()}`
                                                                  : ''}{@render edit(
                                                                  [`${rowKey}.concentrations.${c}.mgPerMl`],
                                                                  'concentration'
                                                            )}
                                                            </div>
                                                      {:else}
                                                            {#if calc.mgPerMl != null}{@render calcChip(
                                                                  calc.mgPerMl, 'mg/mL',
                                                                  `Calculated: ${step.vialMassMg} mg ÷ ${step.finalVolumeMl} mL`
                                                            )}{:else}Not stated
                                                            {/if}
                                                      {/each}
                                                </td
                                                >
                                                {#if editing}
                                                      <td class="row-actions">
                                                            <button
                                                                  class="row-menu-trigger"
                                                                  type="button"
                                                                  aria-label={`Actions for reconstitution ${i + 1}`}
                                                                  aria-haspopup="menu"
                                                                  aria-expanded={rowMenu === rowKey}
                                                                  onclick={() => (rowMenu = rowMenu === rowKey ? null : rowKey)}>
                                                                  ⋯
                                                            </button
                                                            >
                                                            {#if rowMenu === rowKey}
                                                                  <div class="row-menu" role="menu">
                                                                        <button
                                                                              type="button"
                                                                              role="menuitem"
                                                                              onclick={() =>
															openFromMenu([
																`${rowKey}.concentrations.${step.concentrations.length}.mgPerMl`
															])}>Add a concentration
                                                                        </button
                                                                        >
                                                                        <button
                                                                              type="button"
                                                                              role="menuitem"
                                                                              onclick={() => openFromMenu([`${rowKey}.removed`])}>
                                                                              Remove row
                                                                        </button
                                                                        >
                                                                  </div>
                                                            {/if}
                                                      </td>
                                                {/if}
                                          </tr>
                                    {/each}
                                    </tbody>
                              </table>
                        </div>
                  {/if}
                  {#if editing}
                        <button
                              class="add-row"
                              type="button"
                              onclick={() => onedit?.([`reconstitution.${nextAddedRowId(item)}.diluentMl`])}
                        >+ Add reconstitution row
                        </button
                        >
                  {/if}
            </section>
      {/if}

      <section class="wide">
            <h4>Ingredients{@render src('spl')}</h4>
            {#if active.length || inactive.length || ionic.length}
                  <div class="table-wrap">
                        <table class="data-table ing-table">
                              <thead>
                              <tr
                              >
                                    <th>Kind</th>
                                    <th>Substance</th>
                                    <th>UNII</th>
                                    <th>Strength</th>
                                    <th>Basis</th>
                                    <th
                                    >Moieties / ions
                                    </th
                                    >
                              </tr
                              >
                              </thead>
                              <tbody>
                              {#each ingredientRows as ingredient, i (i)}
                                    <tr class:muted={ingredient.kind !== 'active'} class:ion-row={ingredient.kind === 'ionic'}>
                                          <td>{ingredient.kind === 'ionic' ? 'ion constituent' : ingredient.kind}</td>
                                          <td
                                          >{#if ingredient.kind === 'ionic'}<span class="ion-of" aria-hidden="true">↳ </span
                                                >{ionDisplayName(ingredient.ionicContent?.element ?? ingredient.name)}
                                                {#if ingredient.ionicContent?.sourceIngredients.length}<div class="muted">
                                                      constituent of {ingredient.ionicContent.sourceIngredients
                                                            .map((name) => substance(name))
                                                            .join(' + ')}
                                                </div>{/if}
                                          {:else}{ingredient.kind === 'active'
                                                ? substance(ingredient.name)
                                                : ingredient.name}{#if moietyGroupOf(ingredient)}{@const group = moietyGroupOf(ingredient)!}<span
                                                      class="moiety-group"
                                                      style:--group-hue={group.hue}
                                                      title={`Shares ${constituentName(group.name)} with ${group.parts.length - 1} other ingredient(s) — see group ${group.label} below the table`}
                                                >{group.label} · {constituentName(group.name)}{group.parts.find((p) => p.ingredient === ingredient)?.asMoiety ? '' : ' (salt mass)'}</span
                                                >{/if}{/if}
                                                {#if ingredient.part}
                                                      <div class="muted">
                                                            in {ingredient.part.replace(/^[^(]+/, (name) => name.toLowerCase())}
                                                      </div>
                                                {/if}
                                          </td
                                          >
                                          <td class="mono">
                                                {#if ingredient.unii}<a
                                                      href={resolve('/formulary/unii/[unii]', { unii: ingredient.unii })}
                                                >{ingredient.unii}</a
                                                >{:else}—
                                                {/if}
                                          </td>
                                          <td
                                          >{ingredient.strength ? strengthText(ingredient.strength) : '—'}
                                                {#if ingredient.strengthNotes?.length}<sup
                                                      title={ingredient.strengthNotes.join('\n')}
                                                >{ingredient.strengthNotes.map(noteMark).join(',')}</sup
                                                >{/if}{#if manualMark(ingredient)}<sup
                                                      class="manual-mark"
                                                      title="Manually corrected — see the § note below the table"
                                                >{manualMark(ingredient)}</sup
                                                >{/if}{@render edit(
                                                      [
                                                            `details.spl.ingredients.${splIndex(ingredient)}.strength`,
                                                            ...(item.propertyOverrides?.[ingredientCorrectionKey(splIndex(ingredient))]
                                                                  ? [ingredientCorrectionKey(splIndex(ingredient))]
                                                                  : [])
                                                      ],
                                                      `${ingredient.name} strength`
                                                )}
</td
                                          >
                                          <td>{ingredient.basis ?? '—'}</td>
                                          <td class="row-end">
                                                {#if ingredient.kind === 'ionic'}—
                                                {:else}
                                                      {#each ingredient.moieties as moiety, m (m)}{m ? ', ' : ''}
                                                            {#if moiety.unii}<a
                                                                  href={resolve('/formulary/unii/[unii]', { unii: moiety.unii })}
                                                            >{constituentName(moiety.name)}</a
                                                            >{:else}{constituentName(moiety.name)}{/if}
                                                      {:else}—
                                                      {/each}
                                                {/if}
                                          
                                                {#if editing && ingredient.kind === 'active'}<button
                                                      class="edit correct"
                                                      type="button"
                                                      title={`Correct ${ingredient.name}…`}
                                                      aria-label={`Correct ${ingredient.name}`}
                                                      onclick={() => oncorrect?.(splIndex(ingredient))}
                                                ><svg viewBox="0 0 16 16" aria-hidden="true"
                                                ><path d="M3 5.5h8.5M9.5 3 12 5.5 9.5 8M13 10.5H4.5M6.5 8 4 10.5 6.5 13"
                                                       fill="none" stroke="currentColor" stroke-width="1.3"
                                                       stroke-linecap="round" stroke-linejoin="round"/></svg
                                                ></button
                                                >{/if}
                                          </td>
                                    </tr>
                              {/each}
                              </tbody>
                        </table>
                  </div>
                  {#if strengthNotes.length || manualCorrections.length}
                        <ul class="muted footnotes">
                              {#each strengthNotes as note (note)}
                                    <li>{noteMark(note)} — {note}</li>
                              {/each}
                              {#each manualCorrections as correction (correction.ingredient)}
                                    <li class="manual-note"><span class="manual-mark">{manualMark(correction.ingredient)}</span>
                                          — {manualNote(correction)} <span class="manual-tag">manual</span></li>
                              {/each}
                        </ul>
                  {/if}
                  {#if moietyGroups.length}
                        <ul class="moiety-groups">
                              {#each moietyGroups as group (group.unii)}
                                    <li style:--group-hue={group.hue}>
                                          <span class="moiety-group">{group.label} · {constituentName(group.name)}</span>
                                          {#each group.parts as part, p (part.ingredient)}{p ? ' + ' : ''}<span
                                                class:muted={!part.asMoiety}
                                          >{part.ingredient.strength ? strengthText(part.ingredient.strength) : '?'}
                                                {part.asMoiety
                                                      ? part.ingredient.unii === group.unii
                                                            ? `as ${constituentName(group.name)} itself`
                                                            : `as ${constituentName(group.name)}, from ${substance(part.ingredient.name)}`
                                                      : `of ${substance(part.ingredient.name)} (salt mass, not ${constituentName(group.name)})`}</span
                                          >{/each}
                                          {#if group.total}= <b>{group.total} {constituentName(group.name)} in total</b>
                                          {:else}<span class="muted">— not totaled: strengths are not all stated as {constituentName(group.name)} in the same units</span>{/if}
                                    </li>
                              {/each}
                        </ul>
                  {/if}
                  {#if ionic.length}
                        <p class="muted">
                              Ion constituents (↳) are the label-declared total of an ion supplied by the salt ingredients
                              they are listed under. They are part of those ingredients, not additional ingredients, and
                              are not added to their strengths.
                        </p>
                  {/if}
            {:else if item.ingredients.length}
                  <ul>
                        {#each item.ingredients as ingredient (ingredient.name)}
                              <li>
                                    {substance(ingredient.name)}{ingredient.strength ? ` — ${strengthText(ingredient.strength)}` : ''}
                              </li>
                        {/each}
                  </ul>
            {:else}
                  <p class="muted">No ingredient data returned.</p>
            {/if}
      </section>

      <section class="wide">
            <h4>Label (DailyMed / openFDA)</h4>
            <dl>
                  <dt>SPL</dt>
                  <dd>
                        {#if item.splSetId}
                              <a
                                    href={`https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${item.splSetId}`}
                                    rel="noreferrer"
                                    target="_blank">{item.splTitle ?? item.splSetId}</a
                              >
                              {#if d?.spl?.version}· v{d.spl.version}{/if}
                              {#if d?.spl?.publishedDate}· published {d.spl.publishedDate}{/if}
                              {#if d?.spl?.siblingNdc}· via sibling NDC {d.spl.siblingNdc}{/if}
                        {:else}
                              {flag(item.splPresent, 'Present', 'None found')}
                        {/if}{@render src('spl')}
                  </dd>
                  {#if item.splSetId}
                        <dt>SPL set ID</dt>
                        <dd class="mono">{item.splSetId}{@render src('spl')}</dd>
                  {/if}
                  {#if d?.product?.splId}
                        <dt>SPL document ID</dt>
                        <dd class="mono">{d.product.splId}{@render src('ndc')}</dd>
                  {/if}
                  {#if d?.spl?.doseForm}
                        <dt>SPL dose form</dt>
                        <dd>{d.spl.doseForm}{@render src('spl')}</dd>
                  {/if}
                  {#if item.labelIngredients.length}
                        <dt>Label ingredients</dt>
                        <dd>
                              {#if !active.length && !inactive.length && d?.spl?.siblingNdc}
                                    <div class="muted">
                                          Every product on this label, not only this one: the label does not list
                                          this package.
                                    </div>
                              {/if}
                              {#each ['active', 'inactive', null] as kind}
                                    {@const names = item.labelIngredients.filter((ingredient) => ingredient.kind === kind)}
                                    {#if names.length}
                                          <div><span class="muted">{kind === 'active' ? 'Active' : kind === 'inactive' ? 'Excipient' : 'Listed'}:</span>
                                                {names.map((ingredient) => ingredient.name).join('; ')}</div>
                                    {/if}
                              {/each}{@render src('label')}
                        </dd>
                  {/if}
                  {#if d?.label}
                        <dt>openFDA label</dt>
                        <dd>
                              effective {date(d.label.effectiveTime) ?? '?'}{d.label.version
                              ? ` · v${d.label.version}`
                              : ''}{d.label.setId && d.label.setId !== item.splSetId
                              ? ` · set ${d.label.setId}`
                              : ''}{@render src('label')}
                        </dd>
                  {/if}
                  {#if d?.spl?.otherLabels.length}
                        <dt>Other labels</dt>
                        <dd>{d.spl.otherLabels.map((l) => l.title ?? l.setId).join('; ')}{@render src('spl')}</dd>
                  {/if}
            </dl>
            <SplLabelSections sections={d?.label?.sections ?? []} scope={d?.label?.scope ?? null}/>
      </section>

      {#if d?.rxnav}
            <section class="wide">
                  <h4>RxNorm</h4>
                  <dl>
                        <dt>Concept</dt>
                        <dd>
                              {d.rxnav.conceptName ? timeReleaseAfterRelease(d.rxnav.conceptName) : '—'}
                              {#if d.rxnav.rxcui}(<RxCui rxcui={d.rxnav.rxcui} name={d.rxnav.conceptName} />){/if}
                              {d.rxnav.conceptStatus ?? ''}{@render src('rxnav')}
                        </dd>
                        {#if d.rxnav.status}
                              <dt>NDC status</dt>
                              <dd>{d.rxnav.status}{@render src('rxnav')}</dd>
                        {/if}
                        {#if d.rxnav.packaging.length}
                              <dt>Packaging</dt>
                              <dd>{d.rxnav.packaging.join('; ')}{@render src('rxnav')}</dd>
                        {/if}
                        {#if pseudoScd}
                              <dt>Used as</dt>
                              <dd>
                                    {pseudoScd.name} <span class="mono">(pseudo-SCD)</span>
                                    <br/><span class="muted"
                              >RxNorm codes this dry fill by its reconstituted concentration; the catalog places it
							by vial content.</span
                              >
                              </dd>
                        {/if}
                        {#each rxnormProps as prop, i (i)}
                              <dt>{prop.name}</dt>
                              <dd>{prop.value}{@render src('rxnav')}</dd>
                        {/each}
                  </dl>
                  {#if d.rxnav.history.length}
                        <div class="table-wrap">
                              <table class="data-table">
                                    <thead
                                    >
                                    <tr>
                                          <th>Active RxCUI</th>
                                          <th>Original RxCUI</th>
                                          <th>From</th>
                                          <th>To</th>
                                    </tr>
                                    </thead
                                    >
                                    <tbody>
                                    {#each d.rxnav.history as row, i (i)}
                                          <tr>
                                                <td><RxCui rxcui={row.activeRxcui} /></td>
                                                <td><RxCui rxcui={row.originalRxcui} /></td>
                                                <td>{row.start ?? '—'}</td>
                                                <td>{row.end ?? '—'}</td>
                                          </tr>
                                    {/each}
                                    </tbody>
                              </table>
                        </div>
                  {/if}
            </section>
      {/if}
      {#if otherRxnavProps.length}
            <!-- The same facts as above, as RxNav states them: for checking, not reading. -->
            <details class="wide source-data">
                  <summary>Source data: RxNav NDC properties ({otherRxnavProps.length}){@render src('rxnav')}</summary>
                  <dl>
                        {#each otherRxnavProps as prop, i (i)}
                              <dt title={prop.name}>{rxnavLabel(prop.name)}</dt>
                              <dd>{rxnavValue(prop.name, prop.value)}</dd>
                        {/each}
                  </dl>
            </details>
      {/if}
      {#if corrections.length}
            <footer class="wide citations">
                  <h4>Corrections</h4>
                  <ul class="note-list">
                        {#each corrections as c (c.id)}
                              <li id={`${uid}-${c.id}-note`}>
                                    <sup>{c.mark}</sup>
                                    {c.text}.
                                    {#if c.evidence.length}
                                          <ul class="evidence">
                                                {#each c.evidence as ev, i (i)}
                                                      <li><b>{ev.kind}</b> ({ev.source}): {ev.excerpt}</li>
                                                {/each}
                                          </ul>
                                    {/if}
                              </li>
                        {/each}
                  </ul>
            </footer>
      {/if}
      <footer class="wide citations">
            <h4>
                  Sources
                  <button class="link-button" type="button" aria-pressed={showSources} onclick={() => (showSources = !showSources)}
                  >{showSources ? 'Hide' : 'Show'} source marks on every value</button>
            </h4>
            <ol>
                  {#each sources as source, i (source.id)}
                        <li id={`${uid}-source-${i + 1}`}>
                              {#if source.url}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a
                              >{:else}{source.name}{/if}{#if source.detail.some(Boolean)}{` — ${source.detail.filter(Boolean).join(' · ')}`}{/if}
                        </li>
                  {/each}
            </ol>
      </footer>
      {#if overrides.length}
            <footer class="wide citations">
                  <h4>Manual citations</h4>
                  <ol class="manual-list">
                        {#each overrides as [key, override], i (key)}
                              <li id={`${uid}-override-${i + 1}`}>
                                    <b>{overrideFields.find((field) => field.key === key)?.label ?? key}:</b>
                                    {@render overrideValue(key, override.value, overrideFields.find((field) => field.key === key)?.label ?? key)}{@render editButton([key], 'this property')}
                                    {#if override.ambiguity}<span class="ambiguity-tag"
                                    >{AMBIGUITY_KINDS[override.ambiguity.kind]?.label ?? override.ambiguity.kind}</span
                                    >
                                          {#if override.ambiguity.note}
                                                <i>{override.ambiguity.note}</i>{/if}
                                    {/if}
                                    <div class="citation-source"><OverrideCitation {override}/></div>
                                    {@render deleteButton(key, overrideFields.find((field) => field.key === key)?.label ?? key)}
                              </li>
                        {/each}
                  </ol>
                  {#if deleteMessage}<p class="delete-error">{deleteMessage}</p>{/if}
            </footer>
      {/if}
</div>

<style>
      .resolved-summary {
            font-size: 0.85rem;
            line-height: 1.6;
      }

      .citations {
            border-top: 1px solid #e3e8ee;
            padding-top: 0.6rem;
      }

      .citations ol {
            margin: 0;
            padding-left: 1.6rem;
            color: #5c6777;
            font-size: 0.78rem;
            line-height: 1.45;
      }

      .delete {
            margin-left: 0.4rem;
            padding: 0 0.4rem;
            border: 1px solid #f0c4c4;
            border-radius: 4px;
            background: #fff;
            color: #b42318;
            font-size: 0.75rem;
            cursor: pointer;
      }

      .delete:disabled {
            opacity: 0.6;
            cursor: default;
      }

      .citation-source {
            margin-top: 0.1rem;
            color: #5c6777;
      }

      .conversion {
            color: #5c6777;
      }

      .delete-error {
            color: #b42318;
      }

      .ambiguity-tag {
            padding: 0.05rem 0.4rem;
            border-radius: 999px;
            background: #fff0d6;
            color: #8a5a00;
            font-weight: 600;
      }

      .citations ul {
            margin: 0;
            padding: 0;
            list-style: none;
            color: #5c6777;
            font-size: 0.78rem;
            line-height: 1.45;
      }

      .citations a {
            color: #3464a5;
      }

      .citations li:target {
            background: #fff6d6;
      }

      .cite {
            margin-left: 0.15em;
            font-size: 0.7em;
            line-height: 0;
      }

      .cite a {
            color: #3464a5;
            text-decoration: none;
      }

      /* Marks stay out of the way until their fact is hovered or focused. */
      .cite {
            opacity: 0;
            transition: opacity 0.12s;
      }

      :hover > .cite,
      :focus-within > .cite {
            opacity: 1;
      }

      .cite.manual a {
            padding: 0 0.15em;
            border-radius: 3px;
            background: #fff0d6;
            color: #8a5a00;
            font-style: italic;
            font-weight: 600;
      }

      .citations .manual-list {
            list-style: lower-alpha;
      }

      .manual-list ::marker {
            color: #8a5a00;
            font-style: italic;
            font-weight: 600;
      }

      .footnotes {
            list-style: none;
            padding: 0;
            margin: 0.5rem 0 0;
            font-size: 0.85em;
      }

      .detail {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1rem 1.5rem;
            margin-top: 0.75rem;
            border-top: 1px solid #e3e8ee;
            padding-top: 0.75rem;
      }

      .wide {
            grid-column: 1 / -1;
      }

      .stack {
            display: grid;
            gap: 1rem;
            align-content: start;
      }

      h4 {
            margin: 0 0 0.4rem;
            color: #3464a5;
            font-size: 0.75rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
      }

      dl {
            display: grid;
            grid-template-columns: minmax(5.25rem, max-content) minmax(0, 1fr);
            column-gap: 0.5rem;
            row-gap: 0;
            align-items: baseline;
            margin: 0;
            font-size: 0.72rem;
            line-height: 1.3;
      }

      dt {
            color: #5c6777;
            font-size: 0.66rem;
            line-height: 1.3;
            white-space: nowrap;
      }

      dd {
            margin: 0;
            overflow-wrap: anywhere;
      }

      dd .edit {
            width: 1.1rem;
            height: 1.1rem;
            margin-left: 0.2rem;
      }

      .pharm-classes {
            display: grid;
            gap: 0.3rem;
      }

      .pharm-class {
            display: flex;
            align-items: baseline;
            gap: 0.4rem;
            min-width: 0;
      }

      .class-type {
            flex: 0 0 auto;
            color: #5c6777;
      }

      .pharm-empty {
            margin: 0;
            color: #5c6777;
            font-size: 0.85rem;
      }

      .pharm-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
      }

      .pharm-menu {
            position: relative;
      }

      section:hover .pharm-menu .row-menu-trigger {
            opacity: 1;
      }

      .class-tag {
            flex: 0 0 auto;
            padding: 0 0.35rem;
            border: 1px solid #c9d6e8;
            border-radius: 999px;
            color: #3464a5;
            font-size: 0.7rem;
      }

      .hidden-classes {
            margin-top: 0.4rem;
            color: #5c6777;
            font-size: 0.85rem;
      }

      .hidden-classes ul {
            margin: 0.2rem 0 0;
            padding-left: 1.2rem;
      }

      @media (max-width: 420px) {
            dl {
                  grid-template-columns: minmax(4.5rem, max-content) minmax(0, 1fr);
                  column-gap: 0.4rem;
            }
      }

      dd ul,
      section > ul {
            margin: 0;
            padding-left: 1.1rem;
      }

      .mono {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 0.82rem;
      }

      .bad {
            color: #8a3e1d;
            font-weight: 650;
      }

      .ok {
            margin-right: 0.25em;
            color: #1f8a4c;
            font-weight: 700;
      }

      .warn {
            color: #8a6a12;
            font-weight: 650;
      }

      .muted {
            color: #7a8594;
      }

      .provider-errors {
            margin: 0;
            padding: 0.55rem 0.8rem;
            border: 1px solid #ecd9a0;
            border-radius: 0.5rem;
            background: #fdf7e6;
            color: #6b520c;
      }

      .table-wrap {
            max-width: 100%;
            overflow-x: auto;
            border: 1px solid #e0e7f0;
            border-radius: 0.65rem;
            background: #fff;
            box-shadow: 0 2px 8px rgb(28 47 75 / 5%);
      }

      .data-table {
            width: 100%;
            min-width: 36rem;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 0.82rem;
      }

      th,
      td {
            border-bottom: 1px solid #edf0f4;
            padding: 0.65rem 0.75rem;
            text-align: left;
            vertical-align: top;
      }

      th {
            position: sticky;
            top: 0;
            background: #f1f5fb;
            color: #34445c;
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 0.045em;
            text-transform: uppercase;
            white-space: nowrap;
      }

      tbody tr:nth-child(even) {
            background: #f8fafc;
      }

      tbody tr:last-child td {
            border-bottom: 0;
      }

      tbody tr:hover {
            background: #eef5ff;
      }

      .ing-table {
            min-width: 0;
            font-size: 0.78rem;
            line-height: 1.3;
      }

      .ing-table th,
      .ing-table td {
            padding: 0.28rem 0.5rem;
      }

      .ing-table td:nth-child(1),
      .ing-table td:nth-child(3),
      .ing-table td:nth-child(4),
      .ing-table td:nth-child(5) {
            white-space: nowrap;
      }

      .ing-table td:nth-child(2),
      .ing-table tr.ion-row td:nth-child(2) {
            padding-left: 1.25rem;
      }
      .ing-table .ion-of {
            margin-left: -0.9rem;
      }
      .ing-table td:nth-child(6) {
            overflow-wrap: anywhere;
      }

      .ing-table td:nth-child(1) {
            color: #5c6777;
            font-size: 0.72rem;
      }

      .mini-wrap {
            border: 1px dashed #b7c4d6;
            border-left: 3px solid #6b8fc7;
            border-radius: 0.3rem;
            background: #f7f9fc;
            box-shadow: none;
      }

      .mini-table {
            min-width: 0;
            font-size: 0.7rem;
            line-height: 1.3;
      }

      .mini-table th,
      .mini-table td {
            padding: 0.2rem 0.45rem;
      }

      .mini-table th {
            position: static;
            background: transparent;
            color: #6b7a90;
            font-size: 0.6rem;
            font-weight: 600;
            letter-spacing: 0.06em;
      }

      .mini-table tbody tr:nth-child(even) {
            background: transparent;
      }

      .mini-table tbody tr:hover {
            background: #e8f0fb;
      }

      .sib-code {
            display: inline-block;
            padding: 0 0.35em;
            border-radius: 0.6em;
            background: #e3ebf7;
            color: #2f5391;
            font-weight: 600;
            text-decoration: none;
      }

      .sib-code.disabled {
            background: #6b8fc7;
            color: #fff;
            cursor: default;
      }

      .mini-table tbody tr.current {
            background: #eaf1fb;
            font-weight: 600;
      }

      .sib-code:not(.disabled):hover {
            background: #cfdcf1;
      }

      .calc-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.3em;
            padding: 0.1em 0.5em;
            border: 1px solid #e6b89c;
            border-radius: 999px;
            background: #fbede4;
            color: #a4461a;
            font-weight: 600;
            white-space: nowrap;
            cursor: help;
      }

      .calc-chip svg {
            width: 0.95em;
            height: 0.95em;
            flex: 0 0 auto;
      }

      .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip-path: inset(50%);
            white-space: nowrap;
      }

      .manual-mark {
            color: #a8560b;
            font-weight: 700;
      }

      .manual-tag {
            margin-left: 0.3rem;
            padding: 0 0.4rem;
            border-radius: 999px;
            background: #fff0d6;
            color: #8a5a00;
            font-size: 0.72rem;
            font-weight: 650;
      }

      .moiety-group {
            margin-left: 0.5rem;
            padding: 0 0.45rem;
            border-radius: 999px;
            border: 1px solid hsl(var(--group-hue) 55% 70%);
            background: hsl(var(--group-hue) 70% 95%);
            color: hsl(var(--group-hue) 60% 30%);
            font-size: 0.72rem;
            font-weight: 650;
            white-space: nowrap;
      }

      .moiety-groups {
            list-style: none;
            padding: 0;
            margin: 0.5rem 0 0;
            font-size: 0.85em;
      }

      .moiety-groups li {
            padding: 0.2rem 0 0.2rem 0.6rem;
            border-left: 3px solid hsl(var(--group-hue) 55% 60%);
            margin-bottom: 0.25rem;
      }

      .moiety-groups .moiety-group {
            margin: 0 0.4rem 0 0;
      }


      .ing-table td.row-end {
            position: relative;
            padding-right: 2rem;
      }

      .edit.correct {
            position: absolute;
            top: 50%;
            right: 0.35rem;
            margin: 0;
            transform: translateY(-50%);
      }

      .edit {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.35rem;
            height: 1.35rem;
            margin-left: 0.3rem;
            padding: 0;
            border: 1px solid #c9d6e8;
            border-radius: 5px;
            background: #fff;
            color: #3464a5;
            vertical-align: -0.3em;
            cursor: pointer;
      }

      .edit:hover,
      .edit.active {
            border-color: #3464a5;
            background: #3464a5;
            color: #fff;
      }

      .row-actions {
            position: relative;
            width: 2rem;
      }

      .row-menu-trigger {
            padding: 0 0.4rem;
            border: 1px solid transparent;
            border-radius: 5px;
            background: none;
            color: #3464a5;
            cursor: pointer;
      }

      .row-menu-trigger:hover,
      .row-menu-trigger[aria-expanded='true'] {
            border-color: #c9d6e8;
            background: #fff;
      }

      .row-menu {
            position: absolute;
            right: 0;
            z-index: 5;
            display: flex;
            flex-direction: column;
            min-width: 11rem;
            padding: 0.25rem;
            border: 1px solid #c9d6e8;
            border-radius: 6px;
            background: #fff;
            box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
      }

      .row-menu button {
            padding: 0.35rem 0.6rem;
            border: 0;
            border-radius: 4px;
            background: none;
            text-align: left;
            cursor: pointer;
      }

      .row-menu button:hover {
            background: #eef3fa;
      }

      .add-row {
            margin-top: 0.5rem;
            padding: 0.25rem 0.6rem;
            border: 1px dashed #c9d6e8;
            border-radius: 5px;
            background: none;
            color: #3464a5;
            cursor: pointer;
      }

      .visually-hidden {
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip-path: inset(50%);
      }

      /* Override controls stay out of the way until their row is hovered. */
      .edit,
      .row-menu-trigger,
      .add-row {
            opacity: 0;
            transition: opacity 0.12s;
      }

      *:hover > .edit,
      dt:hover + dd > .edit,
      tr:hover .edit,
      tr:hover .row-menu-trigger,
      section:hover > .add-row,
      .edit.active,
      .row-menu-trigger[aria-expanded='true'],
      .edit:focus-visible,
      .row-menu-trigger:focus-visible,
      .add-row:focus-visible {
            opacity: 1;
      }

      .edit svg {
            width: 0.8rem;
            height: 0.8rem;
      }

      .evidence {
            margin: 0.25em 0 0;
            padding-left: 1.1em;
            font-size: 0.8em;
            opacity: 0.8;
      }

      .appearance-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
            margin: 0.25rem 0 0.75rem;
      }

      .appearance-card {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 0.5rem;
            margin: 0;
            padding: 0.75rem;
            max-width: 16rem;
            border: 1px solid #e0e7f0;
            border-radius: 8px;
      }

      .appearance-card.text-only {
            align-items: flex-start;
            max-width: none;
      }

      .appearance-card figcaption {
            font-size: 0.85rem;
            line-height: 1.35;
            text-align: center;
      }

      .appearance-card.text-only figcaption {
            text-align: left;
      }

      .pill-links {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 0.25rem 0.75rem;
            font-size: 0.8rem;
            color: var(--muted, #777);
            margin: 0 0 0.75rem;
      }

      .pill-links-label {
            font-weight: 600;
      }

      /* Provider marks stay out of the way until a value is hovered or they are asked for. */
      .cite.source {
            visibility: hidden;
      }

      dd:hover .cite.source,
      h4:hover .cite.source,
      summary:hover .cite.source,
      .show-sources .cite.source {
            visibility: visible;
      }

      .link-button {
            margin-left: 0.5rem;
            border: 0;
            background: none;
            padding: 0;
            color: #3464a5;
            font: inherit;
            font-size: 0.78rem;
            font-weight: 500;
            letter-spacing: normal;
            text-transform: none;
            text-decoration: underline;
            cursor: pointer;
      }

      .source-data {
            color: #5c6777;
            font-size: 0.85rem;
      }

      .source-data summary {
            cursor: pointer;
            font-weight: 650;
      }

      .source-data dl {
            margin-top: 0.5rem;
      }
</style>
