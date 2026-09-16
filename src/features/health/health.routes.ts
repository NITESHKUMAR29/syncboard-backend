import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHealthRepository } from './health.repository.js';
import { healthResponseSchema } from './health.schemas.js';
import { createHealthService } from './health.service.js';

/**
 * Routes only declare schemas, call the service and return the result (NFR-9).
 */
export const healthRoutes: FastifyPluginAsyncZod<{ version: string }> = async (app, options) => {
  const service = createHealthService(createHealthRepository(app.prisma), options.version);

  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness check',
        description: 'Reports process and database health. Public and never rate limited.',
        response: { 200: healthResponseSchema },
      },
    },
    async () => service.check(),
  );
};
