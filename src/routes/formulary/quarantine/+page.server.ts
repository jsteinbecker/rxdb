import { prisma } from '#lib/server/infrastructure/database.ts';
import { listQuarantined } from '#lib/server/catalog/quarantine.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ packages: await listQuarantined(prisma) });
