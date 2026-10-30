/**
 * Ordered, bounded concurrency for provider calls.
 *
 * @module
 */

/** Preserve input order while limiting concurrent provider operations. */
export async function mapLimit<T, R>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await task(items[index]);
			}
		})
	);
	return results;
}
