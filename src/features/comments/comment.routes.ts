import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import type { PushSender } from '../../push/push-sender.js';
import type { EventBroadcaster } from '../realtime/events.js';
import { taskIdParamsSchema } from '../tasks/task.schemas.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { createCommentRepository } from './comment.repository.js';
import {
  commentIdParamsSchema,
  commentPageSchema,
  commentSchema,
  createCommentBodySchema,
  listCommentsQuerySchema,
  updateCommentBodySchema,
} from './comment.schemas.js';
import { createCommentService, type TaskContext } from './comment.service.js';

export interface CommentRoutesOptions {
  events: EventBroadcaster;
  push: PushSender;
}

/** Comments (Part B §5.1). */
export const commentRoutes: FastifyPluginAsyncZod<CommentRoutesOptions> = async (app, options) => {
  const membership = createMembershipRepository(app.prisma);
  const prisma = app.prisma;

  const service = createCommentService({
    repository: createCommentRepository(prisma),
    access: createAccessGuard(membership),
    clock: app.clock,
    events: options.events,
    push: options.push,
    workspaceIdOfComment: (commentId) => membership.workspaceIdOfComment(commentId),

    async loadTask(taskId): Promise<TaskContext | null> {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          title: true,
          boardId: true,
          assigneeId: true,
          createdBy: true,
          deletedAt: true,
          board: { select: { workspaceId: true } },
        },
      });

      if (!task) return null;

      return {
        taskId: task.id,
        title: task.title,
        boardId: task.boardId,
        workspaceId: task.board.workspaceId,
        assigneeId: task.assigneeId,
        createdBy: task.createdBy,
        deleted: task.deletedAt !== null,
      };
    },

    async listMembers(workspaceId) {
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { userId: true, user: { select: { name: true } } },
      });

      return members.map((member) => ({ userId: member.userId, name: member.user.name }));
    },
  });

  const auth = { onRequest: [app.requireAuth], schema: { security: [{ bearerAuth: [] }] } };

  app.get(
    '/tasks/:id/comments',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['comments'],
        summary: 'List comments, oldest first',
        description: 'Cursor paginated. `nextCursor` is null on the last page.',
        params: taskIdParamsSchema,
        querystring: listCommentsQuerySchema,
        response: { 200: commentPageSchema },
      },
    },
    async (request) => service.list(request.params.id, requireUserId(request), request.query),
  );

  app.post(
    '/tasks/:id/comments',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['comments'],
        summary: 'Add a comment',
        description:
          'Accepts a client-generated id; repeating it returns the existing comment with 200. Mentions of the form @NameWithoutSpaces notify that member.',
        params: taskIdParamsSchema,
        body: createCommentBodySchema,
        response: { 200: commentSchema, 201: commentSchema },
      },
    },
    async (request, reply) => {
      const result = await service.create(request.params.id, requireUserId(request), request.body);

      return reply.status(result.created ? 201 : 200).send(result.comment);
    },
  );

  app.patch(
    '/comments/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['comments'],
        summary: 'Edit your own comment',
        params: commentIdParamsSchema,
        body: updateCommentBodySchema,
        response: { 200: commentSchema },
      },
    },
    async (request) => service.update(request.params.id, requireUserId(request), request.body),
  );

  app.delete(
    '/comments/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['comments'],
        summary: 'Soft delete a comment',
        description: 'The author or an ADMIN.',
        params: commentIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );
};
