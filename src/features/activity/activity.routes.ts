import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireUserId } from '../../plugins/auth.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { workspaceIdParamsSchema } from '../workspaces/workspace.schemas.js';
import { createActivityRepository } from './activity.repository.js';
import { activityPageSchema, listActivityQuerySchema } from './activity.schemas.js';
import { createActivityService } from './activity.service.js';

/** Activity feed (Part B §5.1). */
export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  const service = createActivityService(
    createActivityRepository(app.prisma),
    createAccessGuard(createMembershipRepository(app.prisma)),
  );

  app.get(
    '/workspaces/:id/activity',
    {
      onRequest: [app.requireAuth],
      schema: {
        security: [{ bearerAuth: [] }],
        tags: ['activity'],
        summary: 'Activity feed, newest first',
        description: 'Cursor paginated. `nextCursor` is null on the last page.',
        params: workspaceIdParamsSchema,
        querystring: listActivityQuerySchema,
        response: { 200: activityPageSchema },
      },
    },
    async (request) => service.list(request.params.id, requireUserId(request), request.query),
  );
};
