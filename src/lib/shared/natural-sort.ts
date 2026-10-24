/**
 * Natural ordering for names that embed quantities ("Levothyroxine 50MCG"):
 * numbers compare by magnitude, and numbers carrying a unit compare by their
 * value in a shared base unit, so 250MCG < 0.5MG < 12.5MG < 1G < 2G.
 *
 * @module
 */

type Family = 'mass' | 'volume' | 'amount' | 'iu';

const UNITS: Record<string, [Family, number]> = {
	ng: ['mass', 1e-6],
	mcg: ['mass', 1e-3],
	ug: ['mass', 1e-3],
	µg: ['mass', 1e-3],
	mg: ['mass', 1],
	g: ['mass', 1e3],
	kg: ['mass', 1e6],
	ml: ['volume', 1],
	dl: ['volume', 100],
	l: ['volume', 1000],
	mmol: ['amount', 1],
	mol: ['amount', 1000],
	meq: ['amount', 1],
	eq: ['amount', 1000],
	iu: ['iu', 1],
	unit: ['iu', 1],
	units: ['iu', 1]
};

const TOKEN =
	/(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:\s*(mcg|ug|µg|ng|kg|mg|g|ml|dl|l|mmol|mol|meq|eq|iu|units?)(?![a-z]))?/gi;

type Part = { text: string } | { value: number; family?: Family; base?: number };

const collator = new Intl.Collator(undefined, { numeric: false, sensitivity: 'base' });
const cache = new Map<string, Part[]>();

function parts(input: string): Part[] {
	const hit = cache.get(input);
	if (hit) return hit;
	const out: Part[] = [];
	let last = 0;
	for (const m of input.matchAll(TOKEN)) {
		if (m.index > last) out.push({ text: input.slice(last, m.index) });
		const value = Number(m[1].replace(/,/g, ''));
		const unit = m[2] ? UNITS[m[2].toLowerCase()] : undefined;
		out.push(unit ? { value, family: unit[0], base: value * unit[1] } : { value });
		last = m.index + m[0].length;
	}
	if (last < input.length) out.push({ text: input.slice(last) });
	if (cache.size > 5000) cache.clear();
	cache.set(input, out);
	return out;
}

/** Comparator usable directly in `Array.prototype.sort`. */
export function naturalCompare(a: string, b: string): number {
	const [pa, pb] = [parts(a), parts(b)];
	for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
		const [x, y] = [pa[i], pb[i]];
		if ('text' in x && 'text' in y) {
			const c = collator.compare(x.text, y.text);
			if (c) return c;
		} else if ('text' in x) return 1;
		else if ('text' in y) return -1;
		else {
			const comparable = x.family && x.family === y.family;
			const [u, v] = comparable ? [x.base!, y.base!] : [x.value, y.value];
			if (u !== v) return u < v ? -1 : 1;
		}
	}
	return pa.length - pb.length || collator.compare(a, b);
}
