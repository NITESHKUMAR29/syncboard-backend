import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Prisma client wiring.
 *
 * Prisma 7 connects through a driver adapter rather than a URL in schema.prisma, so the
 * connection string is passed in here. Repositories are the only layer that touches this
 * client (NFR-9).
 */

export type Database = PrismaClient;

export interface PrismaOptions {
  databaseUrl: string;
  logQueries?: boolean;
}

export function createPrismaClient({ databaseUrl, logQueries = false }: PrismaOptions): Database {
  const adapter = new PrismaPg({ connectionString: databaseUrl });

  return new PrismaClient({
    adapter,
    log: logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}
