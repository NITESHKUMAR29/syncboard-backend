import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import type { PushSender } from '../../push/push-sender.js';
import { boardIdParamsSchema } from '../boards/board.schemas.js';
import type { EventBroadcaster } from '../realtime/events.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { createTaskRepository } from './task.repository.js';
import {
  createTaskBodySchema,
  listTasksQuerySchema,
  myTasksQuerySchema,
  taskIdParamsSchema,
  taskPageSchema,
  taskSchema,
  updateTaskBodySchema,
} from './task.schemas.js';
import { createTaskService } from './task.service.js';

export interface TaskRoutesOptions {
  events: EventBroadcaster;
  push: PushSender;
}

/** Tasks (Part B §5.1, §5.4). */
export const taskRoutes: FastifyPluginAsyncZod<TaskRoutesOptions> = async (app, options) => {
  const membership = createMembershipRepository(app.prisma);
  const service = createTaskService({
    repository: createTaskRepository(app.prisma),
    access: createAccessGuard(membership),
    clock: app.clock,
    events: options.events,
    push: options.push,
    workspaceIdOfBoard: (boardId) => membership.workspaceIdOfBoard(boardId),
    workspaceIdOfTask: (taskId) => membership.workspaceIdOfTask(taskId),
  });

  const auth = { onRequest: [app.requireAuth], schema: { security: [{ bearerAuth: [] }] } };

  app.get(
    '/boards/:id/tasks',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'List tasks on a board',
        description: 'Filter by status, assigneeId (or `me`) and priority; sort per Part B §5.1.',
        params: boardIdParamsSchema,
        querystring: listTasksQuerySchema,
        response: { 200: taskPageSchema },
      },
    },
    async (request) => service.list(request.params.id, requireUserId(request), request.query),
  );

  app.post(
    '/boards/:id/tasks',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'Create a task',
        description:
          'Accepts a client-generated id. Repeating a create with the same id returns 200 and the existing task instead of a duplicate.',
        params: boardIdParamsSchema,
        body: createTaskBodySchema,
        response: { 200: taskSchema, 201: taskSchema },
      },
    },
    async (request, reply) => {
      const result = await service.create(request.params.id, requireUserId(request), request.body);

      return reply.status(result.created ? 201 : 200).send(result.task);
    },
  );

  app.get(
    '/me/tasks',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'Tasks assigned to me across workspaces',
        querystring: myTasksQuerySchema,
        response: { 200: taskPageSchema },
      },
    },
    async (request) => service.listMine(requireUserId(request), request.query),
  );

  app.get(
    '/tasks/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'Task detail with labels and counts',
        params: taskIdParamsSchema,
        response: { 200: taskSchema },
      },
    },
    async (request) => service.get(request.params.id, requireUserId(request)),
  );

  app.patch(
    '/tasks/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'Edit, move, assign or reorder a task',
        description:
          'Send only changed fields plus the version. An absent field is unchanged; an explicit null clears it. A stale version returns 409 with the server copy in `current`.',
        params: taskIdParamsSchema,
        body: updateTaskBodySchema,
        response: { 200: taskSchema },
      },
    },
    async (request) => service.update(request.params.id, requireUserId(request), request.body),
  );

  app.delete(
    '/tasks/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['tasks'],
        summary: 'Soft delete a task',
        description: 'The creator or an ADMIN. No version needed: delete wins.',
        params: taskIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );
};
