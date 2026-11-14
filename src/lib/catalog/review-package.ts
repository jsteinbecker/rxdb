/**
 * The pure field-review merge behind "Reload & reinterpret": selected new facts
 * are taken, and retained corrections are resolved after them.
 *
 * @module
 */
import type { ExternalPackage } from './types';
import { resolveEffectivePackage } from './effective-package';
import { overrideField } from '../curation/property-override-fields';
import {
	fieldValue,
	isEmpty,
	listAccess,
	type PreviewRow,
	REVIEW_FIELDS,
	type ReviewField,
	type ReviewRequest,
	summarize
} from '../curation/reinterpret';

/** A review field owns its scalar keys or the whole detail section it replaces. */
function ownsOverride(field: ReviewField, key: string): boolean {
	return (
		key === field.key ||
		(field.detail
			? key.startsWith(`details.${field.detail}.`)
			: (field.keys ?? []).some((owned) => key === owned || key.startsWith(`${owned}.`)))
	);
}

function copyField(target: ExternalPackage, source: ExternalPackage, field: ReviewField) {
	if (field.detail) {
		const value = source.details?.[field.detail] ?? null;
		target.details = { ...(target.details ?? emptyDetails()), [field.detail]: value };
	}
	for (const key of field.keys ?? []) Object.assign(target, { [key]: source[key] });
}

function emptyDetails(): NonNullable<ExternalPackage['details']> {
	return { product: null, packaging: null, label: null, spl: null, rxnav: null };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Arrays marked incomplete only take the scrape when it found more. */
function richer(before: unknown, after: unknown): boolean {
	if (isEmpty(after)) return false;
	if (isEmpty(before)) return true;
	const size = (v: unknown) => (Array.isArray(v) ? v.length : JSON.stringify(v).length);
	return size(after) > size(before);
}

/** Pure review merge: retained corrections are resolved after selected facts change. */
export function reviewPackage(
	current: ExternalPackage,
	fresh: ExternalPackage,
	request: ReviewRequest
) {
	const merged: ExternalPackage = structuredClone({ ...current, evidence: [], splXml: null });
	let recomputeVolume = false;
	const decisions = REVIEW_FIELDS.map((field) => {
		const mark = request.marks[field.key] ?? 'locked';
		const before = fieldValue(current, field);
		const scraped = fieldValue(fresh, field);
		const override = field.editable ? request.overrides[field.key]?.trim() : '';
		let source: PreviewRow['source'] = 'kept';
		let warning: string | null = null;

		const list = listAccess(field.key);
		if (mark === 'broad' && list) {
			const keep = new Set(request.keepRows[field.key] ?? []);
			const rows = list.rows(merged);
			list.withRows(
				merged,
				rows.filter((_, i) => keep.has(i))
			);
			source = 'manual';
			if (keep.size === rows.length) warning = 'No rows were excluded.';
		} else if (override) {
			if (field.key === 'doseForm') overrideField('doseForm')!.set(merged, override, new Set());
			else Object.assign(merged, { [field.keys![0]]: override });
			source = 'manual';
		} else if (mark === 'refresh' && !isEmpty(scraped)) {
			copyField(merged, fresh, field);
			source = 'scrape';
		} else if (mark === 'incorrect') {
			if (isEmpty(scraped)) warning = 'Scrape found nothing to replace it with.';
			else if (same(before, scraped)) warning = 'Scrape returned the same value.';
			else {
				copyField(merged, fresh, field);
				source = 'scrape';
			}
		} else if (mark === 'incomplete') {
			if (richer(before, scraped)) {
				copyField(merged, fresh, field);
				source = 'scrape';
			} else warning = 'Scrape found nothing more complete.';
		} else if (mark === 'refresh') warning = 'Still missing after scrape.';

		const after = fieldValue(merged, field);
		if (
			!same(before, after) &&
			['doseForm', 'size', 'ingredients', 'reconstitution'].includes(field.key)
		)
			recomputeVolume = true;
		if (source !== 'kept' && merged.propertyOverrides) {
			merged.propertyOverrides = Object.fromEntries(
				Object.entries(merged.propertyOverrides).filter(([key]) => !ownsOverride(field, key))
			);
		}
		return { field, mark, source, warning };
	});

	const item = resolveEffectivePackage(merged, { recomputeVolume });
	item.complete = current.complete || fresh.complete;
	item.providerErrors = item.complete ? undefined : fresh.providerErrors;
	return {
		item,
		rows: decisions.map(({ field, mark, source, warning }): PreviewRow => {
			const list = listAccess(field.key);
			return {
				key: field.key,
				label: field.label,
				group: field.group,
				mark,
				source,
				warning,
				before: list
					? list.rows(current).map(list.describe).join('; ') || '—'
					: summarize(fieldValue(current, field)),
				after: list
					? list.rows(item).map(list.describe).join('; ') || '—'
					: summarize(fieldValue(item, field)),
				changed: !same(fieldValue(current, field), fieldValue(item, field))
			};
		})
	};
}
