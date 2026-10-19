// Refetch live formulary packages whose newest snapshot is incomplete, one at a
// time through a running dev server, so provider rate limits are waited out
// rather than fanned into. `--empty` limits it to snapshots with no ingredients.
//
//   node --env-file=.env --import tsx scripts/refetch-incomplete.ts http://localhost:5173 [--empty]
//
// `--ndcs=a,b,…` refetches just those, forced, whether or not they are complete;
// after a strength-rule fix, that is how the packages it changes are restaged.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';

const [base = 'http://localhost:5173'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const emptyOnly = process.argv.includes('--empty');
const listed = process.argv.find((arg) => arg.startsWith('--ndcs='))?.slice('--ndcs='.length).split(',').filter(Boolean);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const rows = await db.$queryRaw<{ ndc: string; n: number }[]>`
  SELECT * FROM (
    SELECT DISTINCT ON (r.source_native_id) r.source_native_id AS ndc,
      (r.payload #>> '{item,complete}')::boolean AS complete,
      jsonb_array_length(r.payload #> '{item,ingredients}')::int AS n
    FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
    WHERE run.source = 'catalog-enrichment' AND run.status = 'completed'
      AND r.source_native_id IN (
        SELECT ei.normalized_value FROM external_identifier ei JOIN entity e ON e.id = ei.entity_id
        WHERE ei.namespace = 'ndc11' AND ei.valid_to IS NULL AND e.status = 'active' AND e.retired_at IS NULL
          AND EXISTS (SELECT 1 FROM formulary_item_package f WHERE f.package_id = e.id AND f.valid_to IS NULL))
    ORDER BY r.source_native_id, r.observed_at DESC) latest
  WHERE NOT complete`;
await db.$disconnect();
const targets = listed ? listed.map((ndc) => ({ ndc })) : rows.filter((row) => !emptyOnly || row.n === 0);
console.log(`${targets.length} package(s) to refetch`);
let done = 0;
let fixed = 0;
for (const { ndc } of targets) {
  const response = await fetch(`${base}/api/v1/ndc/${ndc}${listed ? '?refresh=1' : ''}`).catch((error) => ({ ok: false, status: String(error) }) as const);
  const item = response.ok && 'json' in response ? await response.json() : null;
  const ok = item?.complete === true;
  if (ok) fixed++;
  done++;
  const spl = (item?.details?.spl?.ingredients ?? []).filter((row: { kind: string }) => row.kind === 'active');
  console.log(`${done}/${targets.length} ${ndc} ${ok ? 'complete' : `still incomplete ${JSON.stringify(item?.providerErrors ?? response.status)}`} ingredients=${item?.ingredients?.length ?? '?'}${listed ? ` ${spl.map((row: { name: string; strength: string }) => `${row.name} ${row.strength}`).join(' / ')}` : ''}`);
}
console.log(`${fixed} of ${targets.length} now complete`);
