import type { Env } from '../config/env.js';
import type { FileStorage } from '../storage/file-storage.js';
import { createLocalFileStorage } from '../storage/local-file-storage.js';
import { createS3FileStorage } from '../storage/s3-file-storage.js';

/** A9: an empty STORAGE_BUCKET means local disk, so the project runs with no accounts. */
export async function createFileStorage(env: Env): Promise<FileStorage> {
  if (env.STORAGE_BUCKET) {
    return createS3FileStorage({
      bucket: env.STORAGE_BUCKET,
      region: env.STORAGE_REGION,
      accessKeyId: env.STORAGE_ACCESS_KEY,
      secretAccessKey: env.STORAGE_SECRET_KEY,
      endpoint: env.STORAGE_ENDPOINT,
    });
  }

  return createLocalFileStorage(env.STORAGE_LOCAL_DIR, env.PUBLIC_BASE_URL);
}
