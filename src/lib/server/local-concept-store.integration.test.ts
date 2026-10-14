import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/client';
import { parseLocalConceptInput } from '../local-concept-input.ts';
import type { ExternalPackage } from './catalog-providers';
import { defaultScope } from './catalog-formulary';
import {
  LocalConceptInputError,
  checkLocalConceptDrift,
  createLocalConcept,
  listLocalConcepts,
  localConceptsForRxcuis,
  retireLocalConcept,
  stopSuperseding,
  supersede,
  updateLocalConcept
} from './local-concept-store';

const concept = (strength: string) =>
  parseLocalConceptInput({
    doseForm: 'Injectable Solution',
    evidenceSetId: 'test-set',
    evidenceVersion: '1',
    ingredients: [
      {
        substanceUnii: 'ABCDE12345',
        substanceName: 'Glycine',
        basis: 'as_labeled',
        strengthNumMag: strength,
        strengthNumUom: 'mg',
        strengthDenMag: '1',
        strengthDenUom: 'mL'
      }
    ]
  });

/** Opt-in: all fixture writes are rolled back, even if an assertion fails. */
test(
  'PostgreSQL local concept create, supersede, stop and retire',
  { skip: process.env.RUN_DB_TESTS !== '1', timeout: 60_000 },
  async () => {
    const db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5_000
      })
    });
    const rollback = new Error('ROLLBACK_LOCAL_CONCEPT_FIXTURES');
    const rxcui = `T${randomInt(1_000_000, 9_999_999)}`;
    try {
      await db.$transaction(
        async (tx) => {
          const scope = await defaultScope(tx as unknown as PrismaClient);
          await tx.identifierNamespace.upsert({
            where: { code: 'rxnorm_rxcui' },
            create: { code: 'rxnorm_rxcui', appliesTo: ['clinical_drug'] },
            update: {}
          });
          const rx = await tx.entity.create({ data: { type: 'clinical_drug' } });
          await tx.clinicalDrug.create({ data: { id: rx.id, name: 'wrong RxNorm concept', tty: 'SCD' } });
          await tx.externalIdentifier.create({
            data: {
              entityId: rx.id,
              namespace: 'rxnorm_rxcui',
              value: rxcui,
              normalizedValue: rxcui,
              isPrimary: true
            }
          });

          const made = await createLocalConcept(tx, concept('10'));
          assert.match(made.code, /^LC\d{6}$/);
          const second = await createLocalConcept(tx, concept('20'));
          assert.equal(Number(second.code.slice(2)), Number(made.code.slice(2)) + 1);

          assert.equal((await localConceptsForRxcuis(tx, scope.id, [rxcui])).size, 0);

          const { mappingId } = await supersede(tx, scope.id, made.id, rxcui, null);
          const found = (await localConceptsForRxcuis(tx, scope.id, [rxcui])).get(rxcui);
          assert.ok(found);
          assert.equal(found.id, made.id);
          assert.equal(found.code, made.code);
          assert.equal(found.tty, 'SCD');
          assert.equal(found.name, 'glycine 10 MG/ML Injectable Solution');
          assert.equal(found.supersedes.mappingId, mappingId);
          assert.equal(found.supersedes.name, found.name);
          assert.equal(found.ingredients[0].strengthNumMag, '10');
          assert.ok((await listLocalConcepts(tx, scope.id)).some((c) => c.id === made.id));

          await assert.rejects(
            () => supersede(tx, scope.id, second.id, rxcui, null),
            (e) => e instanceof LocalConceptInputError && e.message.includes(`RxCUI ${rxcui} is already superseded`)
          );
          await assert.rejects(
            () => supersede(tx, scope.id, made.id, 'no-such-rxcui', null),
            (e) => e instanceof LocalConceptInputError && /not in the catalog/.test(e.message)
          );

          await updateLocalConcept(tx, made.id, concept('12.50'));
          const updated = (await localConceptsForRxcuis(tx, scope.id, [rxcui])).get(rxcui);
          assert.equal(updated?.name, 'glycine 12.5 MG/ML Injectable Solution');
          assert.equal(updated?.ingredients.length, 1);

          // RxNorm renames the superseded concept: one open review item, updated not duplicated.
          const renamed = { rxcui, name: 'renamed RxNorm concept', tty: 'SCD', ndcs: [], evidence: [], vetOnly: null };
          assert.equal(await checkLocalConceptDrift(tx, [renamed], []), 1);
          assert.equal(await checkLocalConceptDrift(tx, [renamed], []), 1);
          const drift = await tx.reviewItem.findMany({ where: { mappingId, kind: 'local_concept_drift' } });
          assert.equal(drift.length, 1);
          assert.equal(drift[0].status, 'open');
          assert.equal(drift[0].note, 'renamed');
          assert.equal(drift[0].severity, 'info');
          assert.equal(drift[0].entityId, made.id);
          assert.equal(await checkLocalConceptDrift(tx, [], []), 0);

          const pkg = (rxnav: object) => ({ details: { rxnav } }) as unknown as ExternalPackage;
          const driftItems = () =>
            tx.reviewItem.findMany({ where: { mappingId, kind: 'local_concept_drift', status: 'open' } });
          // (a) a non-ACTIVE concept status marks it inactive.
          assert.equal(
            await checkLocalConceptDrift(tx, [renamed], [
              pkg({ rxcui, conceptStatus: 'Remapped', history: [] })
            ]),
            1
          );
          let items = await driftItems();
          assert.equal(items.length, 1);
          assert.equal(items[0].severity, 'warning');
          assert.equal(items[0].note, 'inactive');
          // Back to a plain rename when the package says ACTIVE.
          await checkLocalConceptDrift(tx, [renamed], [pkg({ rxcui, conceptStatus: 'Active', history: [] })]);
          items = await driftItems();
          assert.deepEqual([items.length, items[0].severity, items[0].note], [1, 'info', 'renamed']);
          // (b) history that maps the rxcui to a different active rxcui.
          await checkLocalConceptDrift(tx, [renamed], [
            pkg({
              rxcui: 'other',
              conceptStatus: 'Active',
              history: [{ originalRxcui: rxcui, activeRxcui: 'X999', start: null, end: null }]
            })
          ]);
          items = await driftItems();
          assert.deepEqual([items.length, items[0].severity, items[0].note], [1, 'warning', 'inactive']);
          // (c) RxNorm's new name matches the local ingredients exactly.
          await checkLocalConceptDrift(tx, [{ ...renamed, name: 'glycine 12.5 MG/ML Injectable Solution' }], []);
          items = await driftItems();
          assert.deepEqual([items.length, items[0].severity, items[0].note], [1, 'info', 'caught_up']);

          await stopSuperseding(tx, scope.id, mappingId);
          assert.equal((await localConceptsForRxcuis(tx, scope.id, [rxcui])).size, 0);
          const stopped = (await listLocalConcepts(tx, scope.id)).find((c) => c.id === made.id);
          assert.equal(stopped?.supersedes?.active, false);
          assert.equal(stopped?.supersedes?.rxcui, rxcui);
          // Stopping a mapping leaves its open drift review item for a person to resolve.
          assert.equal(stopped?.openDrift, (await driftItems()).length);
          assert.equal((await driftItems()).length, 1);
          const unmapped = (await listLocalConcepts(tx, scope.id)).find((c) => c.id === second.id);
          assert.equal(unmapped?.supersedes, null);
          assert.equal(unmapped?.openDrift, 0);
          await assert.rejects(
            () => retireLocalConcept(tx, rx.id),
            (e) => e instanceof LocalConceptInputError
          );
          assert.equal((await tx.entity.findUniqueOrThrow({ where: { id: rx.id } })).retiredAt, null);

          // A fresh mapping resolves, until the concept is retired.
          const again = await supersede(tx, scope.id, made.id, rxcui, null);
          assert.equal((await localConceptsForRxcuis(tx, scope.id, [rxcui])).size, 1);
          await retireLocalConcept(tx, made.id);
          assert.equal((await localConceptsForRxcuis(tx, scope.id, [rxcui])).size, 0);
          assert.ok(!(await listLocalConcepts(tx, scope.id)).some((c) => c.id === made.id));
          await assert.rejects(
            () => retireLocalConcept(tx, made.id),
            (e) => e instanceof LocalConceptInputError
          );
          const mapping = await tx.entityMapping.findUniqueOrThrow({ where: { id: again.mappingId } });
          assert.ok(mapping.validTo);

          throw rollback;
        },
        { timeout: 60_000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.$disconnect();
    }
  }
);
