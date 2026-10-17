/**
 * `Atorvastatin 10 MG Oral Tablet [Lipitor]` → `{ name: 'Atorvastatin 10 MG Oral Tablet', brand:
 * 'Lipitor' }`. RxNorm writes a branded drug's name this way and package titles follow it, so a
 * trailing bracket is always the brand; a name without one has no brand.
 */
export function splitBrand(title: string): { name: string; brand: string | null } {
	const match = title.match(/^(.*\S)\s+\[([^[\]]+)\]\s*$/);
	return match ? { name: match[1], brand: match[2].trim() } : { name: title.trim(), brand: null };
}
