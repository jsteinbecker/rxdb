import { writable, type Readable } from 'svelte/store';

export type RxcuiName = { name: string | null; tty: string | null };

const names = writable<Record<string, RxcuiName>>({});
const requested = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
	timer = null;
	const ids = queue;
	queue = [];
	for (let i = 0; i < ids.length; i += 100) {
		const chunk = ids.slice(i, i + 100);
		try {
			const res = await fetch(`/api/v1/rxcui/names?ids=${chunk.join(',')}`);
			if (!res.ok) throw new Error(String(res.status));
			const found = (await res.json()) as Record<string, RxcuiName>;
			names.update((all) => ({ ...all, ...found }));
		} catch {
			chunk.forEach((id) => requested.delete(id));
		}
	}
}

/** Queue an RxCUI for a batched name lookup; returns the shared name store. */
export function rxcuiNames(rxcui?: string | null): Readable<Record<string, RxcuiName>> {
	if (rxcui && typeof window !== 'undefined' && !requested.has(rxcui)) {
		requested.add(rxcui);
		queue.push(rxcui);
		timer ??= setTimeout(flush, 20);
	}
	return names;
}
