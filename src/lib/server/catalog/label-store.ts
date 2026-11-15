/**
 * Label sections stored once. A package's `details.label.sections` is the full
 * label text, and the NDCs of one product (and every refresh of each) carry the
 * same text. On write the sections move to `spl_label` / `spl_label_section`,
 * keyed by a hash of their content, and the package JSON keeps only
 * `sectionsHash`. On read they are put back, so callers always see
 * `sections` and never the hash.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import type { ExternalPackage } from '../../catalog/types';

type Label = NonNullable<NonNullable<ExternalPackage['details']>['label']>;
type Section = Label['sections'][number];
/** A label as stored: everything but the sections, plus their hash. */
type StoredLabel = Omit<Label, 'sections'> & { sectionsHash: string };

export type LabelDb = Pick<Prisma.TransactionClient, '$queryRaw' | 'splLabel' | 'splLabelSection'>;

/** JSON with object keys sorted, so equal values always serialize alike. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_, nested) =>
		nested && typeof nested === 'object' && !Array.isArray(nested)
			? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: nested
	);
}

export const sectionsHash = (sections: Section[]) =>
	createHash('sha256').update(canonicalJson(sections)).digest();

/** Content-addressed, so a hash's sections never change; cached by hash once read. */
const sectionCache = new Map<string, Section[]>();
const CACHE_LIMIT = 3_000;
function remember(hash: string, sections: Section[]) {
	sectionCache.delete(hash);
	sectionCache.set(hash, sections);
	if (sectionCache.size > CACHE_LIMIT) sectionCache.delete(sectionCache.keys().next().value!);
}

/**
 * A copy of `item` whose label sections are stored in `spl_label` and replaced
 * by their hash. Items without sections come back unchanged.
 */
export async function detachLabel<T extends Pick<ExternalPackage, 'details'>>(
	db: LabelDb,
	item: T
): Promise<T> {
	const label = item.details?.label as (Label & { sectionsHash?: string }) | null | undefined;
	if (!label || !Array.isArray(label.sections)) return item;
	const { sections, ...rest } = label;
	const hash = sectionsHash(sections);
	// Always insert: a cached hash may come from a transaction that rolled back.
	const created = await db.splLabel.createMany({
		data: [
			{
				hash: new Uint8Array(hash),
				setId: label.setId ?? null,
				version: label.version ?? null,
				effectiveTime: label.effectiveTime ?? null
			}
		],
		skipDuplicates: true
	});
	if (created.count)
		await db.splLabelSection.createMany({
			data: sections.map((section, position) => ({
				labelHash: new Uint8Array(hash),
				position,
				key: section.key,
				title: section.title,
				text: section.text,
				blocks: (section.blocks ?? undefined) as Prisma.InputJsonValue | undefined
			}))
		});
	const stored: StoredLabel = { ...rest, sectionsHash: hash.toString('hex') };
	return { ...item, details: { ...item.details!, label: stored as unknown as Label } };
}

/** Puts stored sections back on each item's label, in place. */
export async function attachLabels(
	db: Pick<Prisma.TransactionClient, '$queryRaw'>,
	items: (Pick<ExternalPackage, 'details'> | null | undefined)[]
): Promise<void> {
	const pending = items.flatMap((item) => {
		const label = item?.details?.label as Partial<StoredLabel> | null | undefined;
		return label?.sectionsHash ? [label as StoredLabel] : [];
	});
	if (!pending.length) return;
	const missing = [
		...new Set(pending.map((label) => label.sectionsHash).filter((hex) => !sectionCache.has(hex)))
	];
	if (missing.length) {
		const rows = await db.$queryRaw<
			{ hash: string; key: string; title: string; text: string; blocks: Section['blocks'] | null }[]
		>`
      SELECT encode(label_hash, 'hex') AS hash, key, title, text, blocks
      FROM spl_label_section
      WHERE label_hash = ANY(${missing.map((hex) => Buffer.from(hex, 'hex'))}::bytea[])
      ORDER BY label_hash, position`;
		const byHash = new Map<string, Section[]>(missing.map((hex) => [hex, []]));
		for (const { hash, blocks, ...section } of rows)
			byHash.get(hash)!.push(blocks ? { ...section, blocks } : section);
		for (const [hex, sections] of byHash) remember(hex, sections);
	}
	for (const label of pending) {
		const restored = label as unknown as Label & { sectionsHash?: string };
		restored.sections = sectionCache.get(label.sectionsHash) ?? [];
		delete restored.sectionsHash;
	}
}
