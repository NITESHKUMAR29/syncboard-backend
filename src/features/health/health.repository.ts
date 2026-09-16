import type { Database } from '../../plugins/prisma.js';

/** The only layer that touches Prisma (NFR-9). */
export interface HealthRepository {
  isDatabaseReachable(): Promise<boolean>;
}

export function createHealthRepository(db: Database): HealthRepository {
  return {
    async isDatabaseReachable() {
      try {
        // Tagged template, never string concatenation (NFR-4).
        await db.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}
