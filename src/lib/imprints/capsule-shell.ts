/**
 * A capsule half's color slot, `CAP(...)` / `BODY(...)`, read as a shell and its fill.
 *
 * | Slot | Reads as |
 * | --- | --- |
 * | `CAP(white)` | opaque shell; contents hidden |
 * | `BODY(clear, powder white)` | clear shell; contents form and color required |
 * | `CAP(translucent blue, granules white)` | tinted see-through shell; contents required |
 *
 * @module
 */

/** How a capsule's contents look through a clear or translucent shell. */
export const FILL_FORMS = [
	'powder',
	'granules',
	'pellets',
	'beads',
	'minitablets',
	'liquid',
	'gel',
	'paste'
] as const;
export type FillForm = (typeof FILL_FORMS)[number];

export interface CapsuleShell {
	kind: 'opaque' | 'clear' | 'translucent';
	/** Shell color: the opaque color, or the tint of a translucent shell. Absent for clear. */
	color?: string;
	/** What shows through a clear or translucent shell. */
	contents?: { form: FillForm; color: string };
}

export class ShellError extends Error {}

const FORM_ALIASES: Record<string, FillForm> = {
	granule: 'granules',
	granular: 'granules',
	pellet: 'pellets',
	bead: 'beads',
	minitablet: 'minitablets',
	'mini-tablets': 'minitablets',
	'mini-tablet': 'minitablets'
};

const formOf = (word: string): FillForm | undefined =>
	(FILL_FORMS as readonly string[]).includes(word) ? (word as FillForm) : FORM_ALIASES[word];

/** Read a capsule half's color slot. Throws ShellError with a fix-it message. */
export function parseShell(slot: string): CapsuleShell {
	const [shellPart, contentsPart, ...extra] = slot
		.split(',')
		.map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '));
	if (extra.length)
		throw new ShellError(`Too many commas in "${slot}"; write (<shell>, <form> <color>)`);
	const words = shellPart.split(' ');
	let shell: CapsuleShell;
	if (words[0] === 'clear') {
		if (words.length > 1)
			throw new ShellError(
				`A clear shell has no color; for a tinted shell write "translucent ${words.slice(1).join(' ')}"`
			);
		shell = { kind: 'clear' };
	} else if (words[0] === 'translucent') {
		if (words.length < 2)
			throw new ShellError('A translucent shell needs its tint, e.g. translucent blue');
		shell = { kind: 'translucent', color: words.slice(1).join(' ') };
	} else {
		if (contentsPart !== undefined)
			throw new ShellError(
				`Contents only show through a clear or translucent shell; write (clear, ${contentsPart}) or (translucent ${shellPart}, ${contentsPart})`
			);
		return { kind: 'opaque', color: shellPart };
	}
	if (!contentsPart)
		throw new ShellError(
			`A ${shell.kind} shell must state its contents' form and color, e.g. (${shellPart}, powder white); forms: ${FILL_FORMS.join(', ')}`
		);
	const [formWord, ...color] = contentsPart.split(' ');
	const form = formOf(formWord);
	if (!form)
		throw new ShellError(
			`Unknown contents form "${formWord}"; use one of ${FILL_FORMS.join(', ')}`
		);
	if (!color.length) throw new ShellError(`Contents need a color, e.g. ${form} white`);
	return { ...shell, contents: { form, color: color.join(' ') } };
}

/** Canonical slot text: lowercase, aliases resolved. */
export function formatShell(s: CapsuleShell): string {
	const head =
		s.kind === 'clear' ? 'clear' : s.kind === 'translucent' ? `translucent ${s.color}` : s.color!;
	return s.contents ? `${head}, ${s.contents.form} ${s.contents.color}` : head;
}

/** Plain English, e.g. "clear shell, white powder". */
export function describeShell(s: CapsuleShell): string {
	if (s.kind === 'opaque') return s.color!;
	const head = s.kind === 'clear' ? 'clear shell' : `translucent ${s.color} shell`;
	return `${head}, ${s.contents!.color} ${s.contents!.form}`;
}
