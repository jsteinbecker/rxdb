/**
 * Reload & reinterpret: the fields an NDC page reviews before a fresh scrape, how
 * each is marked (locked, re-scraped, incorrect, …), and the summaries shown in
 * the review table.
 *
 * @module
 */
import type { ExternalPackage } from '../catalog/types';

/**
 * Reload & reinterpret: each field on an NDC page is reviewed before a fresh
 * scrape. Locked fields keep their current value; everything else may be
 * replaced by the new parse, which the user confirms before it is staged.
 */
export type FieldMark = 'locked' | 'refresh' | 'incorrect' | 'incomplete' | 'broad';

export const MARKS: { value: FieldMark; label: string; hint: string }[] = [
	{ value: 'locked', label: 'Locked', hint: 'Keep the current value' },
	{ value: 'refresh', label: 'Refresh', hint: 'Accept whatever the new scrape finds' },
	{ value: 'incorrect', label: 'Incorrect', hint: 'Current value is wrong; try another source' },
	{
		value: 'incomplete',
		label: 'Incomplete',
		hint: 'Value is partial; keep it unless the scrape finds more'
	},
	{
		value: 'broad',
		label: 'Too broad',
		hint: 'Includes data for other products; pick what applies'
	}
];

/** A list-valued field whose rows can be narrowed when the scrape caught too much. */
export type ListAccess = {
	rows: (item: ExternalPackage) => unknown[];
	withRows: (item: ExternalPackage, rows: unknown[]) => void;
	describe: (row: unknown) => string;
	/** Optional quick filters, e.g. one per vial size. */
	facets?: (rows: unknown[]) => { label: string; keep: number[] }[];
};

type Recon = ExternalPackage['reconstitution'][number];
const mass = (mg: number | null) =>
	mg == null ? 'unstated content' : mg >= 1000 ? `${mg / 1000} g` : `${mg} mg`;
const describeRecon = (row: unknown) => {
	const r = row as Recon;
	const conc = r.concentrations.map((c) => `${c.mgPerMl} mg/mL`).join(', ');
	return (
		(r.routes?.length ? `${r.routes.join('/')}: ` : '') +
		`${mass(r.vialMassMg)} vial + ${r.diluentMl} mL` +
		(r.diluents?.length ? ` ${r.diluents.join(' or ')}` : '') +
		(r.finalVolumeMl != null ? ` → ${r.finalVolumeMl} mL` : '') +
		(conc ? ` (${conc})` : '')
	);
};

const LISTS: Record<string, ListAccess> = {
	reconstitution: {
		rows: (item) => item.reconstitution,
		withRows: (item, rows) => (item.reconstitution = rows as Recon[]),
		describe: describeRecon,
		facets: (rows) =>
			[...new Set((rows as Recon[]).map((r) => r.vialMassMg))].map((mg) => ({
				label: `Only ${mass(mg)}`,
				keep: (rows as Recon[]).flatMap((r, i) => (r.vialMassMg === mg ? [i] : []))
			}))
	},
	ingredients: {
		rows: (item) => item.ingredients,
		withRows: (item, rows) => (item.ingredients = rows as ExternalPackage['ingredients']),
		describe: (row) => summarize(row)
	},
	splDetail: {
		rows: (item) => item.details?.spl?.ingredients ?? [],
		withRows: (item, rows) => {
			if (item.details?.spl) item.details.spl = { ...item.details.spl, ingredients: rows as never };
		},
		describe: (row) => {
			const r = row as { name: string; kind: string; strength: string | null };
			return `${r.name} (${r.kind})${r.strength ? ` ${r.strength}` : ''}`;
		}
	},
	label: {
		rows: (item) => item.details?.label?.sections ?? [],
		withRows: (item, rows) => {
			if (item.details?.label)
				item.details.label = { ...item.details.label, sections: rows as never };
		},
		describe: (row) => {
			const r = row as { title: string; text: string };
			return `${r.title}: ${r.text.slice(0, 90)}${r.text.length > 90 ? '…' : ''}`;
		}
	}
};

export const listAccess = (key: string): ListAccess | undefined => LISTS[key];

/** Keys of ExternalPackage a field owns; applying a field copies exactly these. */
type Key = keyof ExternalPackage;
type DetailKey = keyof NonNullable<ExternalPackage['details']>;

export type ReviewField = {
	key: string;
	label: string;
	group: 'Identity' | 'Status' | 'Packaging' | 'Ingredients' | 'Label' | 'RxNav';
	keys?: Key[];
	detail?: DetailKey;
	/** Scalar text fields the user may correct by hand. */
	editable?: boolean;
};

export const REVIEW_FIELDS: ReviewField[] = [
	{
		key: 'description',
		label: 'Package description',
		group: 'Identity',
		keys: ['description'],
		editable: true
	},
	{ key: 'brandName', label: 'Brand name', group: 'Identity', keys: ['brandName'], editable: true },
	{
		key: 'genericName',
		label: 'Generic name',
		group: 'Identity',
		keys: ['genericName'],
		editable: true
	},
	{ key: 'labeler', label: 'Labeler', group: 'Identity', keys: ['labelerName', 'labelerCode'] },
	{
		key: 'productCode',
		label: 'Product NDC',
		group: 'Identity',
		keys: ['productCode'],
		editable: true
	},
	{
		key: 'doseForm',
		label: 'Dose form',
		group: 'Identity',
		keys: ['doseForm', 'doseFormCorrection', 'isDryFill'],
		editable: true
	},
	{
		key: 'listed',
		label: 'FDA listing / marketing end',
		group: 'Status',
		keys: ['listed', 'marketingEndDate']
	},
	{
		key: 'spl',
		label: 'SPL presence / inactivation',
		group: 'Status',
		keys: ['splPresent', 'splInactivated']
	},
	{ key: 'isVeterinary', label: 'Veterinary', group: 'Status', keys: ['isVeterinary'] },
	{ key: 'rxcuiStatus', label: 'RxCUI status', group: 'Status', keys: ['rxcuiStatus'] },
	{ key: 'size', label: 'Unit of use', group: 'Packaging', keys: ['size', 'unitOfUseCorrection'] },
	{ key: 'isMultiDose', label: 'Multi-dose', group: 'Packaging', keys: ['isMultiDose'] },
	{ key: 'reconstitution', label: 'Reconstitution', group: 'Packaging', keys: ['reconstitution'] },
	{ key: 'packaging', label: 'Packaging & siblings', group: 'Packaging', detail: 'packaging' },
	{
		key: 'ingredients',
		label: 'Listed ingredients',
		group: 'Ingredients',
		keys: ['ingredients', 'labelIngredients']
	},
	{ key: 'splDetail', label: 'SPL ingredients & appearance', group: 'Ingredients', detail: 'spl' },
	{ key: 'product', label: 'Product (routes, class, DEA…)', group: 'Label', detail: 'product' },
	{ key: 'splSource', label: 'SPL document', group: 'Label', keys: ['splSetId', 'splTitle'] },
	{ key: 'label', label: 'Label sections', group: 'Label', detail: 'label' },
	{ key: 'rxnav', label: 'RxNav concept', group: 'RxNav', detail: 'rxnav' }
];

export function fieldValue(item: ExternalPackage | null | undefined, field: ReviewField): unknown {
	if (!item) return null;
	if (field.detail) return item.details?.[field.detail] ?? null;
	const keys = field.keys ?? [];
	return keys.length === 1 ? item[keys[0]] : Object.fromEntries(keys.map((k) => [k, item[k]]));
}

export function isEmpty(value: unknown): boolean {
	if (value == null || value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.values(value).every(isEmpty);
	return false;
}

/** Missing data is re-scraped by default; everything present starts locked. */
export function defaultMark(item: ExternalPackage, field: ReviewField): FieldMark {
	return isEmpty(fieldValue(item, field)) ? 'refresh' : 'locked';
}

/** A short, human-readable summary of a field value for review tables. */
export function summarize(value: unknown): string {
	if (isEmpty(value)) return '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value !== 'object') return String(value);
	if (Array.isArray(value)) {
		const parts = value
			.slice(0, 4)
			.map((v) =>
				typeof v === 'object' && v && 'name' in v
					? [v.name, 'strength' in v ? v.strength : null].filter(Boolean).join(' ')
					: typeof v === 'object' && v && 'ndc' in v
						? String(v.ndc)
						: summarize(v)
			);
		return parts.join('; ') + (value.length > 4 ? ` (+${value.length - 4} more)` : '');
	}
	const record = value as Record<string, unknown>;
	if ('sections' in record && Array.isArray(record.sections))
		return `${record.sections.length} sections${record.effectiveTime ? `, effective ${record.effectiveTime}` : ''}`;
	if ('ingredients' in record && Array.isArray(record.ingredients) && 'appearances' in record)
		return `${record.ingredients.length} ingredients, ${(record.appearances as unknown[]).length} appearances${record.doseForm ? `, ${record.doseForm}` : ''}`;
	return (
		Object.entries(record)
			.filter(([, v]) => !isEmpty(v) && (typeof v !== 'object' || Array.isArray(v)))
			.slice(0, 5)
			.map(([k, v]) => `${k}: ${summarize(v)}`)
			.join(' · ') || '(structured)'
	);
}

export type ReviewRequest = {
	marks: Record<string, FieldMark>;
	/** Per-field notes: what is wrong or expected. */
	notes: Record<string, string>;
	/** Hand corrections for editable fields; applied over any scrape result. */
	overrides: Record<string, string>;
	/** For fields marked too broad: indexes of the current rows to keep. */
	keepRows: Record<string, number[]>;
	/** Direct the SPL lookup to a specific DailyMed set ID. */
	preferredSetId: string;
	note: string;
};

export type PreviewRow = {
	key: string;
	label: string;
	group: ReviewField['group'];
	mark: FieldMark;
	before: string;
	after: string;
	changed: boolean;
	source: 'kept' | 'scrape' | 'manual';
	warning: string | null;
};
