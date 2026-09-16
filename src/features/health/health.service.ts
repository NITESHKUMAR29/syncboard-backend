import type { HealthResponse } from './health.schemas.js';
import type { HealthRepository } from './health.repository.js';

export interface HealthService {
  check(): Promise<HealthResponse>;
}

/**
 * Liveness check. `status` stays UP as long as the process answers; `database` reports
 * connectivity separately so an uptime probe can tell the two apart.
 */
export function createHealthService(repository: HealthRepository, version: string): HealthService {
  return {
    async check() {
      const databaseUp = await repository.isDatabaseReachable();
      return {
        status: 'UP',
        database: databaseUp ? 'UP' : 'DOWN',
        version,
      };
    },
  };
}
