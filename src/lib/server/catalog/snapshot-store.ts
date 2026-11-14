/**
 * The snapshot repository: evidence writes, source hashing, staging, the latest
 * cache record per package or concept, and SBD → SCD lookups from concept
 * snapshots.
 *
 * @module
 */
import {
	loadPackageStates,
	lockPackageStates,
	projectionPayload,
	stateSnapshot,
	writeProviderBaseline
} from './package-state-store';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../../generated/client';
import type { ExternalPackage, RxConcept, SourcePayload } from '../../catalog/types';
import { CACHE_SOURCE, CATALOG_VERSION, type PackageSnapshot, readSnapshot } from './cache';
import { parseScdName } from '../../curation/local-concept';

type Db = Prisma.TransactionClient;

const CONCEPT_TTL_MS = 24 * 60 * 60 * 1000;
export type ConceptSnapshot = { version: string; refreshAt: string; concept: RxConcept };
const conceptKey = (rxcui: string) => `rxcui:${rxcui}`;

/** Keep one record per native ID in a source run; the latest payload wins. */
export function uniqueRunEvidence(evidence: SourcePayload[]): SourcePayload[] {
	const uniqueByKey = new Map<string, SourcePayload>();
	for (const item of evidence) uniqueByKey.set(`${item.source}:${item.nativeId}`, item);
	return [...uniqueByKey.values()];
}

export type CacheRecord = { sourceNativeId: string; payload: unknown };

/**
 * The newest completed cache snapshot for each native ID. Prisma's `distinct`
 * fetches every historical row and dedupes in memory, so this is DISTINCT ON,
 * over ids only: payloads are large, and are read just for the winning rows.
 * `withoutLabel` drops the label text (~95% of a package snapshot) in the
 * database, for bulk readers that never show it. A latest snapshot written by
 * an older CATALOG_VERSION is left out here rather than shipped and parsed only
 * for every reader to reject it.
 *
 * Decompressing payloads dominates a bulk read, so label-free payloads are kept
 * in memory by record id and `observed_at`: a record's payload is only ever
 * rewritten together with `observed_at`, so a matching pair is still current.
 */
export async function latestCacheRecords(
	db: Pick<PrismaClient, '$queryRaw'>,
	nativeIds: string[],
	{ withoutLabel = false }: { withoutLabel?: boolean } = {}
): Promise<CacheRecord[]> {
	if (!nativeIds.length) return [];
	const states = await loadPackageStates(
		db as PrismaClient,
		nativeIds.filter((id) => /^\d{11}$/.test(id)),
		{ withoutLabel }
	);
	const durable = [...states.values()].map((state) => ({
		sourceNativeId: state.ndc,
		payload: stateSnapshot(state)
	}));
	nativeIds = nativeIds.filter((id) => !states.has(id));
	if (!nativeIds.length) return durable;
	const latest = await db.$queryRaw<{ id: string; sourceNativeId: string; observedAt: Date }[]>`
    SELECT DISTINCT ON (r.source_native_id)
      r.id, r.source_native_id AS "sourceNativeId", r.observed_at AS "observedAt"
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
      AND r.source_native_id = ANY(${nativeIds}::text[])
    ORDER BY r.source_native_id, r.observed_at DESC`;
	const stamp = (row: { observedAt: Date }) => row.observedAt.getTime();
	const cached = (row: (typeof latest)[number]) => {
		const entry = withoutLabel ? labelFreePayloads.get(row.id) : undefined;
		return entry?.observedAt === stamp(row) ? entry : undefined;
	};
	const missing = latest.filter((row) => !cached(row)).map((row) => row.id);
	const fetched = new Map<string, unknown>();
	if (missing.length) {
		const rows = await db.$queryRaw<{ id: string; payload: unknown }[]>`
      SELECT r.id,
        CASE WHEN ${withoutLabel} THEN r.payload #- '{item,details,label}' ELSE r.payload END AS payload
      FROM source_record r
      WHERE r.id = ANY(${missing}::uuid[]) AND r.payload ->> 'version' = ${CATALOG_VERSION}`;
		for (const row of rows) fetched.set(row.id, row.payload);
	}
	return [
		...durable,
		...latest.flatMap((row) => {
			let payload = cached(row)?.payload;
			if (payload === undefined) {
				payload = fetched.get(row.id) ?? null;
				if (withoutLabel) rememberLabelFree(row.id, stamp(row), payload);
			}
			// Callers may normalize what they read in place; the cached copy stays untouched.
			return payload === null
				? []
				: [
						{
							sourceNativeId: row.sourceNativeId,
							payload: withoutLabel ? structuredClone(payload) : payload
						}
					];
		})
	];
}

/** Label-free payloads by record id; null marks a record from an older CATALOG_VERSION. */
const labelFreePayloads = new Map<string, { observedAt: number; payload: unknown }>();
const LABEL_FREE_LIMIT = 50_000;

function rememberLabelFree(id: string, observedAt: number, payload: unknown) {
	labelFreePayloads.delete(id);
	labelFreePayloads.set(id, { observedAt, payload });
	// Maps iterate in insertion order, so the first key is the least recently stored.
	if (labelFreePayloads.size > LABEL_FREE_LIMIT)
		labelFreePayloads.delete(labelFreePayloads.keys().next().value!);
}

/**
 * Each NDC's property overrides as its latest snapshot holds them, of any
 * CATALOG_VERSION: a version bump makes old snapshots unreadable, and the
 * overrides would otherwise go with them. NDCs whose latest has none are absent.
 */
export async function latestPropertyOverrides(
	db: Pick<PrismaClient, '$queryRaw'>,
	ndcs: string[]
): Promise<Map<string, ExternalPackage['propertyOverrides']>> {
	if (!ndcs.length) return new Map();
	const states = await loadPackageStates(db as PrismaClient, ndcs, { withoutLabel: true });
	const durable = [...states.values()].map((state) => [state.ndc, state.overrides] as const);
	ndcs = ndcs.filter((ndc) => !states.has(ndc));
	if (!ndcs.length) return new Map(durable);
	const rows = await db.$queryRaw<
		{ ndc: string; overrides: ExternalPackage['propertyOverrides'] | null }[]
	>`
    SELECT DISTINCT ON (r.source_native_id)
      r.source_native_id AS ndc, r.payload -> 'item' -> 'propertyOverrides' AS overrides
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
      AND r.source_native_id = ANY(${ndcs}::text[])
    ORDER BY r.source_native_id, r.observed_at DESC`;
	return new Map([
		...durable,
		...rows.flatMap((row) =>
			row.overrides && typeof row.overrides === 'object' && Object.keys(row.overrides).length
				? [[row.ndc, row.overrides] as const]
				: []
		)
	]);
}

/**
 * Concepts staged by earlier searches, each marked fresh while its snapshot has
 * not reached its refresh time. Stale ones still say whether a concept has NDCs.
 */
export async function loadStoredConcepts(
	db: PrismaClient,
	rxcuis: string[],
	now = Date.now()
): Promise<Map<string, { concept: RxConcept; fresh: boolean }>> {
	const records = await latestCacheRecords(db, rxcuis.map(conceptKey));
	return new Map(
		records.flatMap((record) => {
			const snapshot = record.payload as ConceptSnapshot | null;
			return snapshot?.version === CATALOG_VERSION && snapshot.concept?.rxcui
				? [
						[
							snapshot.concept.rxcui,
							{ concept: snapshot.concept, fresh: Date.parse(snapshot.refreshAt) > now }
						] as const
					]
				: [];
		})
	);
}

/** Fetched concepts are staged as provenance until someone loads them. */
export async function loadConceptSnapshots(
	db: PrismaClient,
	rxcuis: string[]
): Promise<Map<string, RxConcept>> {
	const records = await latestCacheRecords(db, rxcuis.map(conceptKey));
	return new Map(
		records.flatMap((record) => {
			const snapshot = record.payload as ConceptSnapshot | null;
			return snapshot?.version === CATALOG_VERSION && snapshot.concept?.rxcui
				? [[snapshot.concept.rxcui, snapshot.concept] as const]
				: [];
		})
	);
}

/**
 * SBD rxcui -> the SCD that lists it as a counterpart, with the brand parsed
 * from the SBD's name. Pure half of `scdsForSbds`. Brands roll up into their
 * generic's node, so an SBD usually has no snapshot of its own; the link lives
 * on the SCD. When two SCDs claim one SBD the first in rxcui order wins, so
 * the answer does not depend on read order.
 */
export function sbdIndex(
	concepts: RxConcept[],
	wanted: string[]
): Map<string, { scdRxcui: string; brand: string | null }> {
	const want = new Set(wanted);
	const out = new Map<string, { scdRxcui: string; brand: string | null }>();
	const scds = concepts
		.filter((concept) => concept.tty === 'SCD')
		.sort((a, b) => (a.rxcui < b.rxcui ? -1 : a.rxcui > b.rxcui ? 1 : 0));
	for (const scd of scds) {
		for (const counterpart of scd.details?.counterparts ?? []) {
			if (counterpart.tty !== 'SBD' || !want.has(counterpart.rxcui) || out.has(counterpart.rxcui))
				continue;
			out.set(counterpart.rxcui, {
				scdRxcui: scd.rxcui,
				// Names without parseable strengths can still carry a trailing brand bracket.
				brand:
					parseScdName(counterpart.name)?.brand ??
					counterpart.name.match(/ \[([^\]]+)\]$/)?.[1] ??
					null
			});
		}
	}
	return out;
}

/**
 * The SCD for each SBD, read from the SCD snapshots that list the SBD as a
 * counterpart. The SQL only narrows which snapshots are read; `sbdIndex` decides.
 * Scans every cached concept, so it is for the local concept editor's supersede
 * target only; display paths start from the scope's mapped SCDs instead
 * (`localConceptsByRxcui`).
 */
export async function scdsForSbds(
	db: Pick<PrismaClient, '$queryRaw'>,
	sbdRxcuis: string[]
): Promise<Map<string, { scdRxcui: string; brand: string | null }>> {
	if (!sbdRxcuis.length) return new Map();
	const rows = await db.$queryRaw<{ payload: unknown }[]>`
    SELECT latest.payload
    FROM (
      SELECT DISTINCT ON (r.source_native_id) r.source_native_id, r.payload
      FROM source_record r
      JOIN ingestion_run run ON run.id = r.ingestion_run_id
      WHERE run.source = ${CACHE_SOURCE} AND run.status = 'completed'
        AND r.source_native_id LIKE 'rxcui:%'
      ORDER BY r.source_native_id, r.observed_at DESC
    ) latest
    WHERE latest.payload ->> 'version' = ${CATALOG_VERSION}
      AND latest.payload #>> '{concept,tty}' = 'SCD'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(latest.payload #> '{concept,details,counterparts}') = 'array'
            THEN latest.payload #> '{concept,details,counterparts}' ELSE '[]'::jsonb END
        ) e
        WHERE e ->> 'rxcui' = ANY(${sbdRxcuis}::text[])
      )
    ORDER BY latest.source_native_id`;
	const concepts = rows.flatMap((row) => {
		const snapshot = row.payload as ConceptSnapshot | null;
		return snapshot?.concept?.rxcui ? [snapshot.concept] : [];
	});
	return sbdIndex(concepts, sbdRxcuis);
}

/** Record raw evidence and cache snapshots without creating catalog entities. */
export async function stageCollection(
	db: PrismaClient,
	concepts: RxConcept[],
	packages: ExternalPackage[]
) {
	const now = Date.now();
	const evidence: SourcePayload[] = [
		...concepts.flatMap((concept) => concept.evidence),
		...packages.flatMap((item) => item.evidence),
		...concepts.map((concept) => ({
			source: CACHE_SOURCE,
			nativeId: conceptKey(concept.rxcui),
			url: `urn:rxdb:catalog:rxcui:${concept.rxcui}`,
			payload: {
				version: CATALOG_VERSION,
				refreshAt: new Date(now + CONCEPT_TTL_MS).toISOString(),
				concept: { ...concept, evidence: [] }
			} satisfies ConceptSnapshot
		}))
	];
	if (!evidence.length && !packages.length) return [];
	return db.$transaction(
		async (tx) => {
			await lockPackageStates(
				tx,
				packages.map((item) => item.ndc)
			);
			const resolved: ExternalPackage[] = [];
			for (const item of packages) {
				const state = await writeProviderBaseline(tx, item);
				resolved.push(stateSnapshot(state).item);
				evidence.push({
					source: CACHE_SOURCE,
					nativeId: item.ndc,
					url: `urn:rxdb:catalog:ndc:${item.ndc}`,
					payload: projectionPayload(state)
				});
			}
			await recordEvidence(tx, uniqueRunEvidence(evidence));
			return resolved;
		},
		{ timeout: 60_000 }
	);
}

/**
 * `withoutLabel` leaves out `details.label`; only for read-only views, since a
 * snapshot written back without it would lose the label text.
 */
export async function loadPackageSnapshots(
	db: PrismaClient,
	ndcs: string[],
	options: { withoutLabel?: boolean } = {}
): Promise<Map<string, PackageSnapshot>> {
	const records = await latestCacheRecords(db, ndcs, options);
	return new Map(
		records.flatMap((record) => {
			const snapshot = readSnapshot(record.payload);
			return snapshot && snapshot.item.ndc === record.sourceNativeId
				? [[record.sourceNativeId, snapshot] as const]
				: [];
		})
	);
}

/** JSON with object keys sorted, so equal payloads always serialize alike. */
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (_, nested) =>
		nested && typeof nested === 'object' && !Array.isArray(nested)
			? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
			: nested
	);
}

/**
 * The hash that decides whether a payload says anything new. A cache
 * snapshot's `refreshAt` changes on every refresh without changing the facts,
 * so it is left out; otherwise every refresh would store another copy.
 */
export function payloadHash(source: string, payload: unknown) {
	const stable =
		source === CACHE_SOURCE && payload && typeof payload === 'object' && 'refreshAt' in payload
			? { ...payload, refreshAt: undefined }
			: payload;
	return createHash('sha256').update(canonicalJson(stable)).digest();
}

/** The newest completed record per source/native ID, to compare hashes against. */
async function latestRecords(db: Db, evidence: SourcePayload[]) {
	if (!evidence.length) return new Map<string, { id: string; payloadHash: Uint8Array }>();
	const rows = await db.$queryRaw<
		{ id: string; source: string; nativeId: string; payloadHash: Uint8Array }[]
	>`
    SELECT DISTINCT ON (run.source, r.source_native_id)
      r.id, run.source, r.source_native_id AS "nativeId", r.payload_hash AS "payloadHash"
    FROM source_record r
    JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.status = 'completed'
      AND run.source = ANY(${[...new Set(evidence.map((item) => item.source))]}::text[])
      AND r.source_native_id = ANY(${[...new Set(evidence.map((item) => item.nativeId))]}::text[])
    ORDER BY run.source, r.source_native_id, r.observed_at DESC`;
	return new Map(rows.map((row) => [`${row.source}:${row.nativeId}`, row]));
}

/** Record provenance inside the transaction supplied by staging or catalog promotion. */
export async function recordEvidence(
	db: Db,
	evidence: SourcePayload[]
): Promise<Map<string, string>> {
	const runs = new Map<string, string>();
	const records = new Map<string, string>();
	const latest = await latestRecords(db, evidence);
	for (const item of evidence) {
		const hash = payloadHash(item.source, item.payload);
		const key = `${item.source}:${item.nativeId}:${hash.toString('hex')}`;
		if (records.has(key)) continue;
		// Unchanged since the last observation: refresh that record in place.
		const previous = latest.get(`${item.source}:${item.nativeId}`);
		if (previous && hash.equals(previous.payloadHash)) {
			await db.sourceRecord.update({
				where: { id: previous.id },
				data: { payload: item.payload as Prisma.InputJsonValue, observedAt: new Date() }
			});
			records.set(key, previous.id);
			continue;
		}
		let runId = runs.get(item.source);
		if (!runId) {
			await db.source.upsert({
				where: { code: item.source },
				create: { code: item.source, description: `Imported from ${item.source}` },
				update: {}
			});
			const run = await db.ingestionRun.create({
				data: { source: item.source, parserVersion: CATALOG_VERSION }
			});
			runId = run.id;
			runs.set(item.source, runId);
		}
		const url = new URL(item.url);
		url.searchParams.delete('api_key');
		const record = await db.sourceRecord.create({
			data: {
				ingestionRunId: runId,
				sourceNativeId: item.nativeId,
				sourceUrl: url.href,
				payload: item.payload as Prisma.InputJsonValue,
				payloadHash: hash
			}
		});
		records.set(key, record.id);
	}
	for (const id of runs.values()) {
		await db.ingestionRun.update({
			where: { id },
			data: { status: 'completed', completedAt: new Date() }
		});
	}
	return records;
}
