import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { ATTACHMENT_MAX_BYTES } from '../storage/uploads.js';

/**
 * Multipart uploads (Part B §7.5).
 *
 * The 1 MB JSON body limit does not apply to these routes; the per-file limit is enforced
 * here and again from the buffered bytes, since a client can understate its size.
 */
export async function registerUploads(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      fileSize: ATTACHMENT_MAX_BYTES,
      files: 1,
    },
  });
}
