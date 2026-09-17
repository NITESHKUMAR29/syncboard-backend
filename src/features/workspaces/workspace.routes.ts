import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUserId } from '../../plugins/auth.js';
import type { PushSender } from '../../push/push-sender.js';
import type { EventBroadcaster } from '../realtime/events.js';
import { createAccessGuard } from './access.js';
import { createMembershipRepository } from './membership.repository.js';
import {
  addMemberBodySchema,
  changeRoleBodySchema,
  createLabelBodySchema,
  createWorkspaceBodySchema,
  labelIdParamsSchema,
  labelSchema,
  memberParamsSchema,
  memberSchema,
  renameWorkspaceBodySchema,
  workspaceIdParamsSchema,
  workspaceListQuerySchema,
  workspacePageSchema,
  workspaceSchema,
} from './workspace.schemas.js';
import { createWorkspaceRepository } from './workspace.repository.js';
import { createWorkspaceService } from './workspace.service.js';

export interface WorkspaceRoutesOptions {
  events: EventBroadcaster;
  push: PushSender;
}

/** Workspaces, members and labels (Part B §5.1). */
export const workspaceRoutes: FastifyPluginAsyncZod<WorkspaceRoutesOptions> = async (
  app,
  options,
) => {
  const membership = createMembershipRepository(app.prisma);
  const service = createWorkspaceService({
    repository: createWorkspaceRepository(app.prisma),
    access: createAccessGuard(membership),
    clock: app.clock,
    events: options.events,
    push: options.push,
    workspaceIdOfLabel: (labelId) => membership.workspaceIdOfLabel(labelId),
  });

  const auth = { onRequest: [app.requireAuth], schema: { security: [{ bearerAuth: [] }] } };

  app.get(
    '/workspaces',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Workspaces I belong to',
        querystring: workspaceListQuerySchema,
        response: { 200: workspacePageSchema },
      },
    },
    async (request) => service.list(requireUserId(request), request.query),
  );

  app.post(
    '/workspaces',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Create a workspace',
        description: 'The creator becomes its OWNER in the same transaction.',
        body: createWorkspaceBodySchema,
        response: { 201: workspaceSchema },
      },
    },
    async (request, reply) => {
      const workspace = await service.create(requireUserId(request), request.body);
      return reply.status(201).send(workspace);
    },
  );

  app.get(
    '/workspaces/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Workspace detail with my role',
        params: workspaceIdParamsSchema,
        response: { 200: workspaceSchema },
      },
    },
    async (request) => service.get(request.params.id, requireUserId(request)),
  );

  app.patch(
    '/workspaces/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Rename a workspace',
        params: workspaceIdParamsSchema,
        body: renameWorkspaceBodySchema,
        response: { 200: workspaceSchema },
      },
    },
    async (request) => service.rename(request.params.id, requireUserId(request), request.body),
  );

  app.delete(
    '/workspaces/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Delete a workspace and all its data',
        params: workspaceIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspaces/:id/members',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'List members',
        params: workspaceIdParamsSchema,
        response: { 200: z.array(memberSchema) },
      },
    },
    async (request) => service.listMembers(request.params.id, requireUserId(request)),
  );

  app.post(
    '/workspaces/:id/members',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Add an existing user by email',
        description: 'The account must already exist; there are no invite emails in v1.',
        params: workspaceIdParamsSchema,
        body: addMemberBodySchema,
        response: { 201: memberSchema },
      },
    },
    async (request, reply) => {
      const member = await service.addMember(
        request.params.id,
        requireUserId(request),
        request.body,
      );
      return reply.status(201).send(member);
    },
  );

  app.patch(
    '/workspaces/:id/members/:userId',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Change a member role',
        params: memberParamsSchema,
        body: changeRoleBodySchema,
        response: { 200: memberSchema },
      },
    },
    async (request) => {
      const callerId = requireUserId(request);
      const targetId = request.params.userId === 'me' ? callerId : request.params.userId;
      return service.changeMemberRole(request.params.id, callerId, targetId, request.body);
    },
  );

  app.delete(
    '/workspaces/:id/members/:userId',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Remove a member, or leave with `me`',
        params: memberParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      const callerId = requireUserId(request);
      const targetId = request.params.userId === 'me' ? callerId : request.params.userId;

      await service.removeMember(request.params.id, callerId, targetId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspaces/:id/labels',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'List labels',
        params: workspaceIdParamsSchema,
        response: { 200: z.array(labelSchema) },
      },
    },
    async (request) => service.listLabels(request.params.id, requireUserId(request)),
  );

  app.post(
    '/workspaces/:id/labels',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Create a label',
        params: workspaceIdParamsSchema,
        body: createLabelBodySchema,
        response: { 201: labelSchema },
      },
    },
    async (request, reply) => {
      const label = await service.createLabel(
        request.params.id,
        requireUserId(request),
        request.body,
      );
      return reply.status(201).send(label);
    },
  );

  app.delete(
    '/labels/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['workspaces'],
        summary: 'Delete a label',
        params: labelIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.deleteLabel(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );
};
