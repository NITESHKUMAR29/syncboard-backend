import { randomUUID } from 'node:crypto';
import type { Clock } from '../../common/clock.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { isAtLeast } from '../../common/roles.js';
import { sanitizeFileName, type FileStorage } from '../../storage/file-storage.js';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_TYPES,
  validateUpload,
} from '../../storage/uploads.js';
import type { AccessGuard } from '../workspaces/access.js';
import type { AttachmentRepository } from './attachment.repository.js';
import type { AttachmentDto } from './attachment.schemas.js';
import type { Attachment } from '../../generated/prisma/client.js';

export interface TaskLocation {
  taskId: string;
  workspaceId: string;
  deleted: boolean;
}

export interface AttachmentService {
  upload(
    taskId: string,
    userId: string,
    file: { buffer: Buffer; fileName: string },
  ): Promise<AttachmentDto>;
  list(taskId: string, userId: string): Promise<AttachmentDto[]>;
  remove(attachmentId: string, userId: string): Promise<void>;
  uploadAvatar(userId: string, file: { buffer: Buffer; fileName: string }): Promise<string>;
}

export interface AttachmentServiceDeps {
  repository: AttachmentRepository;
  access: AccessGuard;
  clock: Clock;
  storage: FileStorage;
  locateTask: (taskId: string) => Promise<TaskLocation | null>;
  workspaceIdOfAttachment: (attachmentId: string) => Promise<string | null>;
}

export function createAttachmentService({
  repository,
  access,
  clock,
  storage,
  locateTask,
  workspaceIdOfAttachment,
}: AttachmentServiceDeps): AttachmentService {
  return {
    async upload(taskId, userId, file) {
      const task = await locateTask(taskId);
      if (!task || task.deleted) throw new NotFoundError('Task not found');

      await access.requireMember(task.workspaceId, userId);

      const validated = await validateUpload(file.buffer, ATTACHMENT_TYPES, ATTACHMENT_MAX_BYTES);
      const safeName = sanitizeFileName(file.fileName);

      // The UUID makes the key unguessable, so a private bucket is not required to stop
      // someone walking the URLs (Part B §7.5).
      const key = `workspaces/${task.workspaceId}/tasks/${taskId}/${randomUUID()}-${safeName}`;
      const stored = await storage.put({
        key,
        body: validated.buffer,
        contentType: validated.mimeType,
      });

      const attachment = await repository.create({
        id: randomUUID(),
        taskId,
        uploadedBy: userId,
        fileName: safeName,
        url: stored.url,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        now: clock.now(),
      });

      return toAttachmentDto(attachment);
    },

    async list(taskId, userId) {
      const task = await locateTask(taskId);
      if (!task || task.deleted) throw new NotFoundError('Task not found');

      await access.requireMember(task.workspaceId, userId);

      const attachments = await repository.listByTask(taskId);
      return attachments.map(toAttachmentDto);
    },

    async remove(attachmentId, userId) {
      const workspaceId = await workspaceIdOfAttachment(attachmentId);
      if (!workspaceId) throw new NotFoundError('Attachment not found');

      const role = await access.requireMember(workspaceId, userId);

      const attachment = await repository.findById(attachmentId);
      if (!attachment) throw new NotFoundError('Attachment not found');

      // FR-ATT-2: the uploader or an ADMIN.
      if (attachment.uploadedBy !== userId && !isAtLeast(role, 'ADMIN')) {
        throw new ForbiddenError('Only the uploader or an ADMIN can delete this attachment');
      }

      // The row goes first: an orphaned file wastes bytes, but a row pointing at a
      // deleted file would break every client that renders it.
      await repository.delete(attachmentId);
      await storage.delete(keyFromUrl(attachment.url));
    },

    async uploadAvatar(userId, file) {
      const validated = await validateUpload(file.buffer, AVATAR_TYPES, AVATAR_MAX_BYTES);
      const safeName = sanitizeFileName(file.fileName);

      const stored = await storage.put({
        key: `avatars/${userId}/${randomUUID()}-${safeName}`,
        body: validated.buffer,
        contentType: validated.mimeType,
      });

      return stored.url;
    },
  };
}

function toAttachmentDto(attachment: Attachment): AttachmentDto {
  return {
    id: attachment.id,
    taskId: attachment.taskId,
    fileName: attachment.fileName,
    url: attachment.url,
    mimeType: attachment.mimeType,
    // BigInt would serialize as a string, or throw; the contract says number.
    sizeBytes: Number(attachment.sizeBytes),
    createdAt: attachment.createdAt.toISOString(),
  };
}

/** Recovers the storage key from a stored URL, for deletion. */
function keyFromUrl(url: string): string {
  const marker = '/files/';
  const index = url.indexOf(marker);

  if (index !== -1) return url.slice(index + marker.length);

  // S3-style URL: everything after the bucket host.
  try {
    return new URL(url).pathname.replace(/^\/+/, '');
  } catch {
    return url;
  }
}
