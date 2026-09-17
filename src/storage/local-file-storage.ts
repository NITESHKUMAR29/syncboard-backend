import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileStorage, PutFileInput, StoredFile } from './file-storage.js';

/**
 * Stores uploads on local disk and serves them from /files/{key} (A9).
 *
 * Keys are built from UUIDs, so a URL cannot be guessed from a task id, and every
 * resolved path is checked to stay inside the root: a key is never trusted to be
 * relative just because the code that built it was.
 */
export function createLocalFileStorage(rootDir: string, publicBaseUrl: string): FileStorage {
  const root = resolve(rootDir);

  function resolveWithinRoot(key: string): string {
    const target = resolve(root, key);

    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Refusing to write outside the storage root: ${key}`);
    }

    return target;
  }

  return {
    async put({ key, body }: PutFileInput): Promise<StoredFile> {
      const target = resolveWithinRoot(key);

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);

      return { key, url: `${publicBaseUrl.replace(/\/$/, '')}/files/${key}` };
    },

    async delete(key: string): Promise<void> {
      // force: an already-missing file is the state we wanted.
      await rm(resolveWithinRoot(key), { force: true });
    },
  };
}

export function localFilePath(rootDir: string, key: string): string {
  return join(resolve(rootDir), key);
}
