import { randomUUID } from 'node:crypto';
import { gsrsMoieties, gsrsMoietyFactor, prismaSubstanceTable } from './unii-substance-store';
import { env } from '$env/dynamic/private';
import { prisma } from '$lib/server/prisma';
import {
	fieldValue,
	isEmpty,
	listAccess,
	type PreviewRow,
	REVIEW_FIELDS,
	type ReviewField,
	type ReviewRequest,
	summarize
} from '$lib/reinterpret';
import { enrichPackages, type ExternalPackage, type SplPreference } from './catalog-providers';
import { resolvePackageVolume } from './catalog-facts';
import { loadPackageSnapshots, stageCollection } from './catalog-store';

const PENDING_TTL_MS = 30 * 60 * 1000;
const pending = new Map<string, { expiresAt: number; item: ExternalPackage }>();

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

/** Scrape fresh, merge per the user's marks, and hold the result for confirmation. */
export async function previewReinterpret(ndc: string, request: ReviewRequest) {
	const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
	if (!current) throw new Error('No staged data for this NDC; load the page first.');

	const unlocked = (key: string) => (request.marks[key] ?? 'locked') !== 'locked';
	// An SPL flagged as wrong is steered away from; an explicit set ID wins.
	const splDoubted = ['splSource', 'splDetail', 'label'].some(
		(key) => request.marks[key] === 'incorrect'
	);
	const preference: SplPreference = {
		prefer: request.preferredSetId.trim() || null,
		avoid: splDoubted && current.splSetId ? [current.splSetId] : []
	};
	const [fresh] = await enrichPackages([ndc], env.OPENFDA_API_KEY, new Map([[ndc, preference]]), {
		moietiesOf: gsrsMoieties(prismaSubstanceTable(prisma)),
		moietyFactorOf: gsrsMoietyFactor(prismaSubstanceTable(prisma))
	});
	if (!fresh) throw new Error('The sources returned nothing for this NDC.');

	const merged: ExternalPackage = structuredClone({ ...current, evidence: [], splXml: null });
	const rows: PreviewRow[] = REVIEW_FIELDS.map((field) => {
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
			Object.assign(merged, { [field.keys![0]]: override });
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
		if (source !== 'kept' && merged.propertyOverrides) {
			merged.propertyOverrides = Object.fromEntries(
				Object.entries(merged.propertyOverrides).filter(
					([key]) =>
						key !== field.key &&
						!(field.key === 'reconstitution' && key.startsWith('reconstitution.'))
				)
			);
		}
		return {
			key: field.key,
			label: field.label,
			group: field.group,
			mark,
			before: list ? list.rows(current).map(list.describe).join('; ') || '—' : summarize(before),
			after: list ? list.rows(merged).map(list.describe).join('; ') || '—' : summarize(after),
			changed: !same(before, after),
			source,
			warning
		};
	});

	merged.resolvedVolume = resolvePackageVolume(
		merged.isDryFill,
		merged.size,
		merged.ingredients,
		merged.reconstitution
	);
	merged.complete = current.complete || fresh.complete;
	merged.providerErrors = merged.complete ? undefined : fresh.providerErrors;
	// Raw payloads from this scrape, plus the review itself, become provenance on apply.
	merged.evidence = [
		...fresh.evidence,
		{
			source: 'user-review',
			nativeId: `${ndc}:${new Date().toISOString()}`,
			url: `urn:rxdb:review:ndc:${ndc}`,
			payload: {
				...request,
				unlocked: REVIEW_FIELDS.filter((f) => unlocked(f.key)).map((f) => f.key)
			}
		}
	];

	const now = Date.now();
	for (const [token, entry] of pending) if (entry.expiresAt < now) pending.delete(token);
	const token = randomUUID();
	pending.set(token, { expiresAt: now + PENDING_TTL_MS, item: merged });
	return {
		token,
		rows,
		splSetId: { before: current.splSetId, after: merged.splSetId },
		providerErrors: fresh.providerErrors ?? []
	};
}

export async function applyReinterpret(ndc: string, token: string) {
	const entry = pending.get(token);
	if (!entry || entry.item.ndc !== ndc || entry.expiresAt < Date.now()) return false;
	pending.delete(token);
	await stageCollection(prisma, [], [entry.item]);
	return true;
}
