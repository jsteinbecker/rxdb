// Read-only: compare every live formulary package's displayed actives with its SCD.
//   node --env-file=.env --import tsx scripts/audit-scd-strengths.ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/client.ts';
import { CATALOG_VERSION } from '../src/lib/server/catalog-cache.ts';
import { correctedIngredients, packageTitle, packageStrengthText, packageDisplayTitle } from '../src/lib/package-title.ts';
import { mgPer, mlPer } from '../src/lib/units.ts';
import { rxNormStrengths, sameSubstance } from '../src/lib/spl-strength-checks.ts';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const rows = await db.$queryRaw<{ ndc: string; payload: any }[]>`
  SELECT DISTINCT ON (r.source_native_id) r.source_native_id AS ndc, r.payload
  FROM source_record r JOIN ingestion_run run ON run.id = r.ingestion_run_id
  WHERE run.source = 'catalog-enrichment' AND run.status = 'completed'
    AND r.source_native_id IN (
      SELECT ei.normalized_value FROM external_identifier ei JOIN entity e ON e.id = ei.entity_id
      WHERE ei.namespace = 'ndc11' AND ei.valid_to IS NULL AND e.status = 'active' AND e.retired_at IS NULL
        AND EXISTS (SELECT 1 FROM formulary_item_package f WHERE f.package_id = e.id AND f.valid_to IS NULL))
  ORDER BY r.source_native_id, r.observed_at DESC`;
const out: any[] = [];
for (const { ndc, payload } of rows) {
  const item = payload?.item;
  if (!item) continue;
  const concept = item.details?.rxnav?.conceptName ?? null;
  const rx = rxNormStrengths(concept);
  let shown: { name: string; strength: string | null; basisNamed?: boolean }[] = [];
  let title = '';
  try { shown = correctedIngredients(item); title = packageTitle(item); } catch (e) { title = 'THROW ' + e; }
  const problems: string[] = [];
  let text: string | null = null; let generated: string | null = null;
  try { text = packageStrengthText(item); generated = packageDisplayTitle(item); } catch (e) { problems.push('THROW ' + e); }
  // `piperacillin 2 g / tazobactam 250 mg`, `bumetanide 0.25 mg/mL`
  const parts = (text ?? '').split(' / ').map((part) => {
    const m = part.match(/^(.*?)\s+([\d.]+)\s*(\S+?)(?:\/(mL))?$/);
    return m ? { name: m[1], value: Number(m[2]), unit: m[3], perMl: !!m[4] } : { name: part, value: NaN, unit: '', perMl: false };
  });
  if (!text) problems.push('no-actives');
  else for (const entry of rx) {
    const want = `${entry.value} ${entry.unit}${entry.perUnit ? `/${entry.per === 1 ? '' : entry.per}${entry.perUnit}` : ''}`;
    const hit = parts.find((s) => sameSubstance(s.name, entry.name));
    if (!hit) { problems.push(`name: SCD ${entry.name} ${want}; shown ${text}`); continue; }
    const rxMl = entry.perUnit ? mlPer(entry.perUnit) : null;
    if (!!entry.perUnit !== hit.perMl) { problems.push(`form: SCD ${want}; shown ${hit.value} ${hit.unit}${hit.perMl ? '/mL' : ''}`); continue; }
    const scale = (v: number, u: string) => v * (mgPer(u) ?? (u.toLowerCase() === entry.unit.toLowerCase() ? 1 : NaN));
    const rxValue = scale(entry.value, entry.unit) / (rxMl ? entry.per * rxMl : 1);
    const own = scale(hit.value, hit.unit);
    if (!(Math.abs(own - rxValue) <= 0.02 * rxValue)) problems.push(`amount: SCD ${entry.name} ${want}; shown ${hit.value} ${hit.unit}${hit.perMl ? '/mL' : ''}`);
  }
  for (const s of parts) if (text && rx.length && !rx.some((e) => sameSubstance(e.name, s.name))) problems.push(`extra: ${s.name}`);
  out.push({ ndc, version: payload.version, stale: payload.version !== CATALOG_VERSION, concept, title, generated, text, shown, problems,
    spl: (item.details?.spl?.ingredients ?? []).filter((i: any) => i.kind === 'active').map((i: any) => ({ name: i.name, basis: i.basis, strength: i.strength, moieties: (i.moieties ?? []).map((m: any) => m.name) })),
    directory: item.ingredients });
}
await db.$disconnect();
const file = process.argv[2] ?? 'audit.json';
(await import('node:fs')).writeFileSync(file, JSON.stringify(out, null, 1));
const bad = out.filter((o) => o.problems.length);
console.log(`catalog version ${CATALOG_VERSION}; ${out.length} packages; ${out.filter((o) => o.stale).length} stale snapshots; ${out.filter((o) => !o.concept).length} no concept; ${bad.length} disagree with SCD`);
const byConcept = new Map<string, typeof bad>();
for (const o of bad) byConcept.set(o.concept, [...(byConcept.get(o.concept) ?? []), o]);
for (const [concept, list] of [...byConcept].sort((a, b) => b[1].length - a[1].length))
  console.log(`${list.length}\t${concept}\n\t${list[0].ndc}: ${list[0].problems.join(' ; ')}`);
