import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { workspaceIdParamsSchema } from '../workspaces/workspace.schemas.js';
import { createSyncRepository } from './sync.repository.js';
import { syncQuerySchema, syncResponseSchema } from './sync.schemas.js';
import { createSyncService } from './sync.service.js';

/** Delta sync (Part B §5.1, §7.1). */
export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createSyncService(
    createSyncRepository(app.prisma),
    createAccessGuard(createMembershipRepository(app.prisma)),
    app.clock,
  );

  app.get(
    '/workspaces/:id/sync',
    {
      onRequest: [app.requireAuth],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['sync'],
        summary: 'Changes since a timestamp',
        description:
          'Returns boards, tasks and comments changed since `since`, including soft-deleted rows, plus the full current members and labels. Omit `since` for a full first sync. Store `serverTime` and send it as the next `since`.',
        params: workspaceIdParamsSchema,
        querystring: syncQuerySchema,
        response: { 200: syncResponseSchema },
      },
    },
    async (request) =>
      service.changes(request.params.id, requireUserId(request), request.query.since),
  );
};
