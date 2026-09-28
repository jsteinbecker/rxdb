import { env } from '$env/dynamic/private';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/client.ts';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (import.meta.env.DEV) globalForPrisma.prisma = prisma;
