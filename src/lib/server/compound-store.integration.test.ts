import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../generated/client';
import { rational } from '../rational';
import { defaultScope } from './catalog-formulary';
import {
  addComponent,
  CompoundError,
  createCompound,
  deleteCompound,
  listCompounds,
  loadCompound,
  removeComponent,
  renameCompound,
  saveLines,
  setSaved
} from './compound-store';

const r = (n: number, d = 1) => rational(n, d)!;
const rejects = (work: Promise<unknown>, status: number) =>
  assert.rejects(work, (error) => error instanceof CompoundError && error.status === status);

/** Opt-in: every write is rolled back, even if an assertion fails. */
test(
  'PostgreSQL compound store',
  { skip: process.env.RUN_DB_TESTS !== '1', timeout: 60_000 },
  async (t) => {
    const db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5_000
      })
    });
    const rollback = new Error('ROLLBACK_COMPOUND_FIXTURES');
    try {
      await db.$transaction(
        async (tx) => {
          const nested = new Proxy(tx, {
            get(target, property) {
              if (property === '$transaction')
                return (work: (client: Prisma.TransactionClient) => unknown) => work(tx);
              return Reflect.get(target, property);
            }
          }) as unknown as PrismaClient;

          const scope = await defaultScope(nested);
          const link = await nested.formularyItemPackage.findFirst({
            where: { validTo: null, formularyItem: { scopeId: scope.id } },
            select: { packageId: true }
          });
          if (!link) return t.skip('no formulary packages in this database');

          const id = await createCompound(nested, scope.id, 'Test compound');
          // A unique violation aborts the surrounding rollback transaction, so
          // contain it in a savepoint.
          await nested.$executeRawUnsafe('SAVEPOINT duplicate_name');
          await rejects(createCompound(nested, scope.id, 'Test compound'), 409);
          await nested.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_name');
          await renameCompound(nested, scope.id, id, 'Test compound 2');

          // a package outside the scope's formulary is refused
          await rejects(
            addComponent(nested, scope.id, id, {
              packageId: '00000000-0000-4000-8000-000000000000',
              role: 'active',
              conc: null,
              doseUnit: 'mg'
            }),
            404
          );

          await addComponent(nested, scope.id, id, {
            packageId: link.packageId,
            role: 'active',
            conc: r(100),
            doseUnit: 'mg'
          });
          await addComponent(nested, scope.id, id, {
            packageId: link.packageId,
            role: 'diluent',
            conc: null,
            doseUnit: 'mg'
          });

          let compound = await loadCompound(nested, scope.id, id);
          assert.equal(compound.lines.length, 2);
          assert.deepEqual(compound.lines[0].conc, r(100));
          assert.equal(compound.lines[1].role, 'diluent');

          const [active, diluent] = compound.lines;
          await saveLines(nested, scope.id, id, {
            total: r(30),
            lines: [
              { slotId: active.slotId, conc: r(100), dose: r(1500), volume: r(15) },
              { slotId: diluent.slotId, conc: null, dose: null, volume: r(15) }
            ]
          });
          compound = await loadCompound(nested, scope.id, id);
          assert.deepEqual(compound.total, r(30));
          assert.deepEqual(compound.lines[0].dose, r(1500));
          assert.deepEqual(compound.lines[0].volume, r(15));
          assert.deepEqual(compound.lines[1].volume, r(15));

          // exact fractions survive a round trip
          await saveLines(nested, scope.id, id, {
            total: null,
            lines: [{ slotId: active.slotId, conc: r(2500, 19), dose: r(1500), volume: r(57, 5) }]
          });
          compound = await loadCompound(nested, scope.id, id);
          assert.equal(compound.total, null);
          assert.deepEqual(compound.lines[0].conc, r(2500, 19)); // derived from dose ÷ volume

          // a slot from another compound is a 409, not a write
          await rejects(
            saveLines(nested, scope.id, id, {
              total: null,
              lines: [{ slotId: '00000000-0000-4000-8000-000000000000', conc: null, dose: null, volume: null }]
            }),
            409
          );

          // saving locks every mutator
          await setSaved(nested, scope.id, id, true);
          await rejects(renameCompound(nested, scope.id, id, 'Nope'), 409);
          await rejects(removeComponent(nested, scope.id, id, active.slotId), 409);
          await rejects(deleteCompound(nested, scope.id, id), 409);
          await rejects(
            saveLines(nested, scope.id, id, { total: null, lines: [] }),
            409
          );
          assert.equal((await loadCompound(nested, scope.id, id)).locked, true);

          await setSaved(nested, scope.id, id, false);
          await removeComponent(nested, scope.id, id, diluent.slotId);
          assert.equal((await loadCompound(nested, scope.id, id)).lines.length, 1);
          assert.ok((await listCompounds(nested, scope.id)).some((c) => c.id === id && c.components === 1));

          await deleteCompound(nested, scope.id, id);
          await rejects(loadCompound(nested, scope.id, id), 404);
          await rejects(loadCompound(nested, scope.id, 'not-a-uuid'), 404);

          // an empty compound cannot be saved
          const empty = await createCompound(nested, scope.id, 'Empty compound');
          await rejects(setSaved(nested, scope.id, empty, true), 409);

          throw rollback;
        },
        { timeout: 50_000 }
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.$disconnect();
    }
  }
);
