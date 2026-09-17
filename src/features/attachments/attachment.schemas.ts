import { z } from 'zod';

/** Attachment shapes (Part B §5.3). */

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  fileName: z.string(),
  url: z.string(),
  mimeType: z.string(),
  /** BIGINT in the database; serialized as a number (Part A, "Serialization pitfalls"). */
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});

export const attachmentIdParamsSchema = z.object({ id: z.string().uuid() });

export type AttachmentDto = z.infer<typeof attachmentSchema>;
