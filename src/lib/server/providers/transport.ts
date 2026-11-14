/**
 * Provider transport: timeouts, shared responses, rate-limit retries, openFDA key
 * rotation, forced-refresh invalidation, and per-source failure reporting.
 *
 * @module
 */
import { loggedFetch } from '../infrastructure/log';
import { naturalCompare } from '../../shared/natural-sort';
import type { ProviderError } from '../../catalog/types';

/** A provider answered with a non-OK status; `status` 429 is a rate limit. */
class ProviderHttpError extends Error {
	constructor(
		url: string,
		readonly status: number
	) {
		super(`${new URL(url).hostname} responded ${status}`);
	}
}

// ── Shared provider responses ────────────────────────────────────────────────
// Packages of one product, and products of one labeler, ask the providers the
// same questions: the same SPL document, label, labeler query and RxNav
// relations. Each URL is fetched once and its promise shared for a short while,
// across NDCs, batches and requests. Keyed by the fetch in use, so a test that
// swaps `globalThis.fetch` starts with an empty cache.
const RESPONSE_TTL_MS = 10 * 60 * 1000;
/** A concept's relations and properties change only with an RxNorm release. */
const RXNAV_CONCEPT_TTL_MS = 6 * 60 * 60 * 1000;
const ttlOf = (url: string) =>
	/\/REST\/rxcui\/\d+\/(related|properties|allProperties)\.json/.test(url)
		? RXNAV_CONCEPT_TTL_MS
		: RESPONSE_TTL_MS;
const RESPONSE_LIMIT = 600;
type CachedResponse = { at: number; ttl: number; value: Promise<unknown> };
const responseCaches = new WeakMap<typeof fetch, Map<string, CachedResponse>>();
let responsesNotBefore = 0;

function responseCache(): Map<string, CachedResponse> {
	let cache = responseCaches.get(globalThis.fetch);
	if (!cache) responseCaches.set(globalThis.fetch, (cache = new Map()));
	return cache;
}

/** Whether an application cache predates the most recent forced refresh. */
export function providerResponsesExpired(at: number): boolean {
	return at < responsesNotBefore;
}

/** Forced refreshes must reach the providers: ignore responses cached before now. */
export function expireProviderResponses(now = Date.now()) {
	responsesNotBefore = now;
}

function shared<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
	const cache = responseCache();
	const now = Date.now();
	const hit = cache.get(key);
	if (hit && hit.at >= responsesNotBefore && now - hit.at < hit.ttl) return hit.value as Promise<T>;
	cache.delete(key);
	if (cache.size >= RESPONSE_LIMIT) {
		for (const [entry, value] of cache) {
			if (cache.size < RESPONSE_LIMIT && now - value.at < value.ttl) break;
			cache.delete(entry);
		}
	}
	const value = load();
	cache.set(key, { at: now, ttl, value });
	// A failure is not an answer; the next caller asks again.
	value.catch(() => {
		if (cache.get(key)?.value === value) cache.delete(key);
	});
	return value;
}

// ── Rate limits ─────────────────────────────────────────────────────────────
// One SCD can have hundreds of NDCs, each asking several providers, so a load
// reliably trips openFDA's and DailyMed's rate limits. A 429 is not an answer:
// read as one, amoxicillin's 668 packages were staged with no ingredients at
// all. So a rate-limited host is paused for every caller (Retry-After, else a
// doubling wait) and the request asked again; only a limit that outlasts every
// retry is reported on the package.
const FETCH_TIMEOUT_MS = 12_000;
const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
type RateLimitPolicy = {
	retries: number;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
};
const defaultPolicy: RateLimitPolicy = {
	retries: 4,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now: () => Date.now()
};
let rateLimitPolicy = defaultPolicy;
const pausedUntil = new Map<string, number>();

/** Tests swap the clock and waits out; called with nothing, restores the defaults. */
export function setRateLimitPolicy(policy: Partial<RateLimitPolicy> = {}) {
	rateLimitPolicy = { ...defaultPolicy, ...policy };
	pausedUntil.clear();
}

function retryAfterMs(response: Response): number | null {
	const header = response.headers.get('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - rateLimitPolicy.now();
	return ms > 0 ? Math.min(ms, BACKOFF_MAX_MS) : null;
}

/** `loggedFetch`, waiting out a host's rate limit and retrying, each attempt with its own timeout. */
async function rateLimitedFetch(
	url: string,
	init: RequestInit,
	expected: number[]
): Promise<Response> {
	const host = new URL(url).hostname;
	for (let attempt = 0; ; attempt++) {
		// Another caller's 429 pauses this one too.
		const paused = (pausedUntil.get(host) ?? 0) - rateLimitPolicy.now();
		if (paused > 0) await rateLimitPolicy.sleep(paused);
		const response = await loggedFetch(
			url,
			{ ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
			expected
		);
		if (response.status !== 429 || attempt >= rateLimitPolicy.retries) return response;
		const wait =
			retryAfterMs(response) ?? Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
		pausedUntil.set(host, Math.max(pausedUntil.get(host) ?? 0, rateLimitPolicy.now() + wait));
	}
}

// ── openFDA key rotation ────────────────────────────────────────────────────
// Each openFDA key has its own daily quota. When one answers 429 the request is
// retried with the next configured key, and later requests start from the key
// that last worked.
let fdaKeys: string[] = [];
let fdaKeyIndex = 0;

/** Registers every configured openFDA key (OPENFDA_API_KEY, OPENFDA_API_KEY2, …). */
export function setFdaApiKeys(keys: (string | undefined)[]) {
	fdaKeys = [...new Set(keys.filter((key): key is string => !!key))];
	fdaKeyIndex = 0;
}

/** The OPENFDA_API_KEY* values of an env object, in name order. */
export function fdaApiKeysFrom(env: Record<string, string | undefined>): string[] {
	return Object.keys(env)
		.filter((name) => /^OPENFDA_API_KEY\d*$/.test(name))
		.sort(naturalCompare)
		.map((name) => env[name] ?? '')
		.filter(Boolean);
}

/**
 * Fetches `url`, moving to the next openFDA key whenever the current one is
 * rate limited, and waiting the limit out once every key is.
 */
async function fetchRotatingFdaKey(
	url: string,
	init: RequestInit,
	expected: number[]
): Promise<Response> {
	const parsed = new URL(url);
	if (parsed.hostname !== 'api.fda.gov' || !parsed.searchParams.has('api_key') || !fdaKeys.length)
		return rateLimitedFetch(url, init, expected);
	let response = await loggedFetch(url, init, expected);
	for (let tried = 1; response.status === 429 && tried < fdaKeys.length; tried++) {
		const current = parsed.searchParams.get('api_key');
		if (fdaKeys[fdaKeyIndex] === current) fdaKeyIndex = (fdaKeyIndex + 1) % fdaKeys.length;
		parsed.searchParams.set('api_key', fdaKeys[fdaKeyIndex]);
		response = await loggedFetch(
			parsed.href,
			{ ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
			expected
		);
	}
	return response.status === 429 ? rateLimitedFetch(parsed.href, init, expected) : response;
}

export function getJson(url: string, emptyOn404 = false): Promise<unknown> {
	return shared(`json:${emptyOn404 ? '404:' : ''}${url}`, ttlOf(url), async () => {
		const response = await fetchRotatingFdaKey(
			url,
			{ headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) },
			// openFDA answers a search that matches nothing with 404.
			emptyOn404 ? [404] : []
		);
		if (response.status === 404 && emptyOn404) return { results: [] };
		if (!response.ok) throw new ProviderHttpError(url, response.status);
		return response.json();
	});
}

export function getText(url: string): Promise<string> {
	return shared(`text:${url}`, RESPONSE_TTL_MS, async () => {
		const response = await rateLimitedFetch(url, { headers: { Accept: '*/*' } }, []);
		if (!response.ok) throw new ProviderHttpError(url, response.status);
		return response.text();
	});
}

/** One failed provider per source, so the page can say which facts are missing and why. */
export function providerFailures(
	results: [ProviderError['source'], PromiseSettledResult<unknown>][]
): ProviderError[] {
	const failures = new Map<ProviderError['source'], ProviderError>();
	for (const [source, result] of results) {
		if (result.status !== 'rejected' || failures.has(source)) continue;
		const error = result.reason;
		const status = error instanceof ProviderHttpError ? error.status : null;
		const message =
			status === 429
				? 'rate limit exceeded'
				: error instanceof Error && error.name === 'TimeoutError'
					? 'timed out'
					: status !== null
						? `responded ${status}`
						: 'did not answer';
		failures.set(source, { source, status, message });
	}
	return [...failures.values()];
}
