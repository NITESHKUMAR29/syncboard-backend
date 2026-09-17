import type { MultipartFile } from '@fastify/multipart';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { requireUserId } from '../../plugins/auth.js';
import type { FileStorage } from '../../storage/file-storage.js';
import { ATTACHMENT_MAX_BYTES } from '../../storage/uploads.js';
import { taskIdParamsSchema } from '../tasks/task.schemas.js';
import { createAccessGuard } from '../workspaces/access.js';
import { createMembershipRepository } from '../workspaces/membership.repository.js';
import { createAttachmentRepository } from './attachment.repository.js';
import { attachmentIdParamsSchema, attachmentSchema } from './attachment.schemas.js';
import { createAttachmentService, type TaskLocation } from './attachment.service.js';

export interface AttachmentRoutesOptions {
  storage: FileStorage;
}

/** Attachments and avatar upload (Part B §5.1, §7.5). */
export const attachmentRoutes: FastifyPluginAsyncZod<AttachmentRoutesOptions> = async (
  app,
  options,
) => {
  const membership = createMembershipRepository(app.prisma);
  const prisma = app.prisma;

  const service = createAttachmentService({
    repository: createAttachmentRepository(prisma),
    access: createAccessGuard(membership),
    clock: app.clock,
    storage: options.storage,
    workspaceIdOfAttachment: (id) => membership.workspaceIdOfAttachment(id),

    async locateTask(taskId): Promise<TaskLocation | null> {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, deletedAt: true, board: { select: { workspaceId: true } } },
      });

      if (!task) return null;

      return {
        taskId: task.id,
        workspaceId: task.board.workspaceId,
        deleted: task.deletedAt !== null,
      };
    },
  });

  const auth = { onRequest: [app.requireAuth], schema: { security: [{ bearerAuth: [] }] } };

  app.get(
    '/tasks/:id/attachments',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['attachments'],
        summary: 'List attachments',
        params: taskIdParamsSchema,
        response: { 200: z.array(attachmentSchema) },
      },
    },
    async (request) => service.list(request.params.id, requireUserId(request)),
  );

  app.post(
    '/tasks/:id/attachments',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['attachments'],
        summary: 'Upload a file',
        description:
          'multipart/form-data with one part named `file`. Max 10 MB; jpeg, png, webp and pdf only, checked from the file bytes.',
        consumes: ['multipart/form-data'],
        params: taskIdParamsSchema,
        response: { 201: attachmentSchema },
      },
    },
    async (request, reply) => {
      const file = await readFilePart(request.file({ limits: { fileSize: ATTACHMENT_MAX_BYTES } }));

      const attachment = await service.upload(request.params.id, requireUserId(request), file);
      return reply.status(201).send(attachment);
    },
  );

  app.delete(
    '/attachments/:id',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['attachments'],
        summary: 'Delete an attachment and its stored file',
        params: attachmentIdParamsSchema,
        response: { 204: z.void() },
      },
    },
    async (request, reply) => {
      await service.remove(request.params.id, requireUserId(request));
      return reply.status(204).send();
    },
  );

  app.post(
    '/users/me/avatar',
    {
      ...auth,
      schema: {
        ...auth.schema,
        tags: ['users'],
        summary: 'Upload an avatar',
        description: 'multipart/form-data with one part named `file`. Images only, max 2 MB.',
        consumes: ['multipart/form-data'],
        response: {
          200: z.object({
            id: z.string().uuid(),
            name: z.string(),
            email: z.string(),
            avatarUrl: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const userId = requireUserId(request);
      const file = await readFilePart(request.file());

      const avatarUrl = await service.uploadAvatar(userId, file);
      const user = await prisma.user.update({
        where: { id: userId },
        data: { avatarUrl, updatedAt: app.clock.now() },
      });

      return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
    },
  );
};

/** Buffers the single `file` part, turning a missing part into a 400 with a field. */
async function readFilePart(
  pending: Promise<MultipartFile | undefined>,
): Promise<{ buffer: Buffer; fileName: string }> {
  const part = await pending;

  if (!part) {
    throw new ValidationError('Expected a multipart file part named "file"', {
      file: 'REQUIRED',
    });
  }

  // toBuffer throws once the declared limit is exceeded; the error handler maps that to
  // 413 FILE_TOO_LARGE.
  const buffer = await part.toBuffer();

  return { buffer, fileName: part.filename };
}
