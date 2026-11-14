/**
 * A first draft of a local concept from one NDC's label: one row per active
 * SPL ingredient, in mg per 1 mL, rounded to 3 significant figures. Pure; the
 * user reviews and edits the draft before anything is saved.
 *
 * @module
 */

import type { ExternalPackage, LabelIngredient } from '../catalog/types';
import type { LocalIngredient } from './local-concept.ts';
import { parseScdName } from './local-concept.ts';
import type { LocalConceptInput } from './local-concept-input.ts';
import {
	ingredientCorrectionKey,
	parseIngredientCorrection
} from '../medication/ingredient-correction.ts';
import { ingredientGroup } from '../medication/ingredient-group.ts';
import { parseStrength } from '../medication/strength-storage.ts';
import { mgPer, mlPer } from '../medication/units.ts';

/** `x` to 3 significant figures, as a plain decimal (never exponent notation). */
function sig3(x: number): string {
	return Number(x.toPrecision(3)).toLocaleString('en-US', {
		useGrouping: false,
		maximumFractionDigits: 20
	});
}

/**
 * Milligrams per mL for a strength like `7 g` (per package, divided by
 * `volumeMl`) or `.85 g/100mL`; null when either part is not a mass or volume.
 */
function mgPerMl(text: string | null | undefined, volumeMl: number | null): number | null {
	const s = parseStrength(text ?? null);
	if (!s) return null;
	const mg = mgPer(s.strengthNumUom);
	if (mg === null) return null;
	const amount = s.strengthNumMag * mg;
	if (s.strengthDenUom === '1') return volumeMl ? amount / volumeMl : null;
	const ml = mlPer(s.strengthDenUom);
	return ml === null ? null : amount / (s.strengthDenMag * ml);
}

const groupKey = (name: string) => ingredientGroup(name).toLowerCase();

/** The package fields a draft reads; a staged package has them too. */
export type DraftSource = Pick<
	ExternalPackage,
	'ndc' | 'splSetId' | 'size' | 'ingredients' | 'details' | 'propertyOverrides'
>;

export function localConceptDraft(item: DraftSource): {
	input: LocalConceptInput;
	warnings: string[];
} {
	const warnings: string[] = [];
	const spl = item.details?.spl?.ingredients ?? [];
	const size = item.size;
	const volumeMl =
		size?.kind === 'volume' && size.unit && mlPer(size.unit) !== null
			? size.value * mlPer(size.unit)!
			: null;
	// The NDC directory's strengths, keyed by the moiety each one groups under.
	const directory = new Map(
		(item.ingredients ?? []).map((row) => [groupKey(row.name), row.strength] as const)
	);
	const activeUniis = new Set(
		spl.flatMap((row) => (row.kind === 'active' && row.unii ? [row.unii.toUpperCase()] : []))
	);

	/** The amount the label stated before a stored correction moved it to a moiety basis. */
	const statedBeforeCorrection = (index: number): string | null => {
		const stored = item.propertyOverrides?.[ingredientCorrectionKey(index)]?.value;
		const correction = stored ? parseIngredientCorrection(stored) : null;
		return correction?.conversion?.original ?? null;
	};

	const rows: LocalIngredient[] = [];
	const seen = new Set<string>();
	spl.forEach((row: LabelIngredient, index) => {
		if (row.kind !== 'active') return;
		const unii = row.unii?.toUpperCase() ?? '';
		if (!unii) {
			warnings.push(`${row.name}: no UNII on the label; add it by hand`);
			return;
		}
		if (seen.has(unii)) {
			warnings.push(`${row.name}: listed twice on the label; kept the first row`);
			return;
		}
		const moiety = row.moieties[0];
		let onMoiety =
			(row.basis === 'moiety' || !!row.strengthNotes?.length) &&
			!!moiety?.unii &&
			moiety.unii.toUpperCase() !== unii;
		let mg: number | null;
		if (onMoiety && activeUniis.has(moiety!.unii!.toUpperCase())) {
			// The moiety is another row's own substance (N-acetyl-L-tyrosine coded as
			// tyrosine beside tyrosine itself): two rows can't share one name, so this
			// one stays as labeled, at the amount the label stated.
			onMoiety = false;
			const stated = statedBeforeCorrection(index);
			if (!stated) {
				warnings.push(`${row.name}: stated as ${moiety!.name}; enter the label amount`);
				return;
			}
			mg = mgPerMl(stated, volumeMl);
		} else if (onMoiety) {
			// The directory states salts on the moiety basis already. Without it, the
			// SPL amount is only moiety-basis when the SPL row says so; a row flagged by
			// strength notes alone may still carry the salt's mass.
			mg = mgPerMl(directory.get(groupKey(row.name)), null);
			if (mg === null && row.basis === 'moiety') mg = mgPerMl(row.strength, volumeMl);
			if (mg === null) {
				warnings.push(
					`${row.name}: no directory strength on the ${moiety!.name} basis; add it by hand`
				);
				return;
			}
		} else {
			mg = mgPerMl(row.strength, volumeMl);
		}
		if (mg === null || !(mg > 0)) {
			warnings.push(`${row.name}: strength could not be read as mg/mL; add it by hand`);
			return;
		}
		seen.add(unii);
		rows.push({
			substanceUnii: unii,
			substanceName: row.name,
			basis: onMoiety ? 'active_moiety' : 'as_labeled',
			moietyUnii: onMoiety ? moiety!.unii!.toUpperCase() : null,
			moietyName: onMoiety ? moiety!.name : null,
			strengthNumMag: sig3(mg),
			strengthNumUom: 'MG',
			strengthDenMag: '1',
			strengthDenUom: 'ML'
		});
	});

	const conceptName = item.details?.rxnav?.conceptName;
	const doseForm = (conceptName && parseScdName(conceptName)?.doseForm) || '';
	if (!doseForm) warnings.push('Dose form not filled; enter the RxNorm dose form');

	const label = item.details?.label;
	const evidenceSetId = label?.setId ?? item.splSetId ?? '';
	const evidenceVersion = label?.effectiveTime ?? item.details?.spl?.version ?? '';
	if (!evidenceSetId || !evidenceVersion)
		warnings.push('Evidence not filled; this NDC has no label set id or version');

	warnings.push('Ionic content not filled; enter it from the label');

	return {
		input: {
			doseForm,
			ingredients: rows,
			evidenceSetId,
			evidenceVersion,
			evidenceNdc: item.ndc,
			ionicContent: null,
			note: null
		},
		warnings
	};
}
