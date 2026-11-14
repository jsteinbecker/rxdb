/**
 * The CMS Medicare Part B NDC–HCPCS crosswalk (its ASP, OPPS, AWP and PrEP
 * files): kept at the newest quarter CMS has published, and read for each NDC's
 * billing formats. Parsing lives in `catalog/cms-billing.ts`.
 *
 * @module
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient } from '../../../generated/client';
import {
	billingFormat,
	crosswalkFileOf,
	crosswalkQuarter,
	FILE_RANK,
	latestCrosswalkUrl,
	parseCrosswalkCsv,
	type CmsBillingFormat,
	type CrosswalkFile,
	type CrosswalkRow
} from '../../catalog/cms-billing';
import { logger } from '../infrastructure/log';

const log = logger('cms-billing');

const PAGE = 'https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (formulary CMS crosswalk sync)' };
/** How long a check of the CMS page holds before looking again. */
const RECHECK_MS = 24 * 60 * 60 * 1000;

let checkedAt = 0;
let inFlight: Promise<void> | null = null;

async function unzipCsvs(zip: ArrayBuffer) {
	const dir = await mkdtemp(join(tmpdir(), 'cms-crosswalk-'));
	try {
		await writeFile(join(dir, 'x.zip'), Buffer.from(zip));
		await promisify(execFile)('unzip', ['-o', '-q', 'x.zip', '-d', 'out'], { cwd: dir });
		const names = await readdir(join(dir, 'out'));
		const files: { name: string; file: CrosswalkFile; csv: string }[] = [];
		for (const name of names) {
			const file = crosswalkFileOf(name);
			if (file) files.push({ name, file, csv: await readFile(join(dir, 'out', name), 'latin1') });
		}
		return files;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function syncCrosswalk(db: PrismaClient) {
	const page = await fetch(PAGE, { headers: HEADERS });
	if (!page.ok) throw new Error(`CMS pricing page returned ${page.status}`);
	const url = latestCrosswalkUrl(await page.text());
	if (!url) throw new Error('No NDC–HCPCS crosswalk is linked on the CMS pricing page.');
	const current = await db.cmsCrosswalkRow.findFirst({ select: { sourceUrl: true } });
	if (current?.sourceUrl === url) return;
	const zip = await fetch(url, { headers: HEADERS });
	if (!zip.ok) throw new Error(`CMS crosswalk download returned ${zip.status}`);
	const files = await unzipCsvs(await zip.arrayBuffer());
	const quarter =
		crosswalkQuarter(url) ?? crosswalkQuarter(files[0]?.name ?? '') ?? 'Unknown quarter';
	// One row per NDC and code: the ASP file wins over OPPS, PrEP and AWP.
	const rows = new Map<string, CrosswalkRow>();
	for (const { file, csv } of files)
		for (const row of parseCrosswalkCsv(csv, file)) {
			const key = `${row.ndc11}|${row.hcpcs}`;
			const held = rows.get(key);
			if (!held || FILE_RANK[row.file] < FILE_RANK[held.file]) rows.set(key, row);
		}
	if (!rows.size) throw new Error(`The ${quarter} crosswalk had no NDC rows.`);
	const data = [...rows.values()].map((row) => ({ ...row, quarter, sourceUrl: url }));
	await db.$transaction(
		async (tx) => {
			await tx.cmsCrosswalkRow.deleteMany({});
			for (let i = 0; i < data.length; i += 5000)
				await tx.cmsCrosswalkRow.createMany({ data: data.slice(i, i + 5000) });
		},
		{ timeout: 120_000 }
	);
	log.info(`CMS crosswalk: loaded ${data.length} rows for ${quarter}`);
}

/**
 * Bring the stored crosswalk to the newest quarter CMS has published, at most
 * once a day. A failure leaves the last quarter in place and is only logged, so
 * an unreachable cms.gov never blocks adding or refreshing an item.
 */
export async function ensureCrosswalk(db: PrismaClient, { force = false } = {}) {
	if (!force && Date.now() - checkedAt < RECHECK_MS) return;
	inFlight ??= syncCrosswalk(db)
		.then(() => {
			checkedAt = Date.now();
		})
		.catch((error) => {
			log.warn(`CMS crosswalk sync failed: ${error instanceof Error ? error.message : error}`);
		})
		.finally(() => {
			inFlight = null;
		});
	await inFlight;
}

/** CMS billing formats by NDC, best file first; NDCs CMS doesn't list are absent. */
export async function cmsBilling(
	db: PrismaClient,
	packages: { ndc: string; doseForm: string | null }[]
): Promise<Map<string, CmsBillingFormat[]>> {
	const forms = new Map(packages.map((item) => [item.ndc, item.doseForm]));
	const rows = forms.size
		? await db.cmsCrosswalkRow.findMany({ where: { ndc11: { in: [...forms.keys()] } } })
		: [];
	const out = new Map<string, CmsBillingFormat[]>();
	for (const row of rows) {
		const list = out.get(row.ndc11) ?? [];
		list.push(billingFormat(row as CrosswalkRow, forms.get(row.ndc11) ?? null, row.quarter));
		out.set(row.ndc11, list);
	}
	for (const list of out.values())
		list.sort((a, b) => FILE_RANK[a.file] - FILE_RANK[b.file] || a.hcpcs.localeCompare(b.hcpcs));
	return out;
}
