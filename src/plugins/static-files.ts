import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';

/**
 * Serves locally stored uploads at /files/{key} (A9).
 *
 * Only registered when STORAGE_BUCKET is empty: an S3 bucket hands out its own URLs, so
 * proxying them through here would be pointless work.
 *
 * Keys embed a UUID, which is what keeps a file private — the specification's design, so
 * that the project runs without a bucket or signed URLs. It does mean anyone holding a
 * link can open it, exactly like an unlisted link on a file-sharing site.
 */
export async function registerStaticFiles(app: FastifyInstance, env: Env): Promise<void> {
  if (env.STORAGE_BUCKET) return;

  const root = resolve(env.STORAGE_LOCAL_DIR);

  // The plugin refuses to start if its root is missing, which it is until the first
  // upload on a fresh checkout.
  await mkdir(root, { recursive: true });

  await app.register(fastifyStatic, {
    root,
    prefix: '/files/',
    // These are user-supplied files, so they must never be interpreted by a browser in
    // this origin's context. Everything is offered as a download rather than rendered.
    index: false,
    dotfiles: 'deny',
    setHeaders: (response) => {
      response.header('X-Content-Type-Options', 'nosniff');
      response.header('Content-Security-Policy', "default-src 'none'; sandbox");
      // The key contains a UUID and the file never changes, so it can be cached hard.
      response.header('Cache-Control', 'private, max-age=31536000, immutable');
    },
  });
}
