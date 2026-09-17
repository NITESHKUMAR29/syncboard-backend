import type { Attachment } from '../../generated/prisma/client.js';
import type { Database } from '../../plugins/prisma.js';

export interface AttachmentRepository {
  create(input: {
    id: string;
    taskId: string;
    uploadedBy: string;
    fileName: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    now: Date;
  }): Promise<Attachment>;
  findById(id: string): Promise<Attachment | null>;
  listByTask(taskId: string): Promise<Attachment[]>;
  delete(id: string): Promise<void>;
}

export function createAttachmentRepository(db: Database): AttachmentRepository {
  return {
    create({ id, taskId, uploadedBy, fileName, url, mimeType, sizeBytes, now }) {
      return db.attachment.create({
        data: {
          id,
          taskId,
          uploadedBy,
          fileName,
          url,
          mimeType,
          sizeBytes: BigInt(sizeBytes),
          createdAt: now,
        },
      });
    },

    findById(id) {
      return db.attachment.findUnique({ where: { id } });
    },

    listByTask(taskId) {
      return db.attachment.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });
    },

    async delete(id) {
      await db.attachment.delete({ where: { id } });
    },
  };
}
