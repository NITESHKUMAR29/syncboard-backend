import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import type { EventBroadcaster } from '../realtime/events.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { workspaceIdParamsSchema } from '../workspaces/workspace.schemas.js';
import { createBoardRepository } from './board.repository.js';
import {
  boardIdParamsSchema,
  boardSchema,
  createBoardBodySchema,
  listBoardsQuerySchema,
  updateBoardBodySchema,
} from './board.schemas.js';
import { createBoardService } from './board.service.js';

export interface BoardRoutesOptions {
  events: EventBroadcaster;
}

/** Boards (Part B §5.1). */
export const boardRoutes: FastifyPluginAsyncZod<BoardRoutesOptions> = async (app, options) => {
  const membership = createMembershipRepository(app.prisma);
  const service = createBoardService({
    repository: createBoardRepository(app.prisma),
    access: createAccessGuard(membership),
    clock: app.clock,
    events: options.events,
    workspaceIdOfBoard: (boardId) => membership.workspaceIdOfBoard(boardId),
  });

  const auth = { onRequest: [app.requireAuth], schema: { security: [{ bearerAuth: [] }] } };

  app.get(
    '/workspaces/:id/boards',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['boards'],
        summary: 'List boards ordered by position',
        params: workspaceIdParamsSchema,
        querystring: listBoardsQuerySchema,
        response: { 200: z.array(boardSchema) },
      },
    },
    async (request) =>
      service.list(request.params.id, requireUserId(request), request.query.includeArchived),
  );

  app.post(
    '/workspaces/:id/boards',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['boards'],
        summary: 'Create a board',
        params: workspaceIdParamsSchema,
        body: createBoardBodySchema,
        response: { 201: boardSchema },
      },
    },
    async (request, reply) => {
      const board = await service.create(request.params.id, requireUserId(request), request.body);
      return reply.status(201).send(board);
    },
  );

  app.get(
    '/boards/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['boards'],
        summary: 'Board detail',
        params: boardIdParamsSchema,
        response: { 200: boardSchema },
      },
    },
    async (request) => service.get(request.params.id, requireUserId(request)),
  );

  app.patch(
    '/boards/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['boards'],
        summary: 'Rename, reorder or archive a board',
        description:
          'Requires the version the client last saw. A stale version returns 409 with the server copy in `current`.',
        params: boardIdParamsSchema,
        body: updateBoardBodySchema,
        response: { 200: boardSchema },
      },
    },
    async (request) => service.update(request.params.id, requireUserId(request), request.body),
  );

  app.delete(
    '/boards/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['boards'],
        summary: 'Soft delete a board and its tasks',
        params: boardIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );
};
