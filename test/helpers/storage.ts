import type { FileStorage, PutFileInput, StoredFile } from '../../src/storage/file-storage.js';

/** In-memory storage, so upload tests never touch the disk. */
export interface FakeFileStorage extends FileStorage {
  readonly files: Map<string, { body: Buffer; contentType: string }>;
}

export function createFakeFileStorage(): FakeFileStorage {
  const files = new Map<string, { body: Buffer; contentType: string }>();

  return {
    files,

    put({ key, body, contentType }: PutFileInput): Promise<StoredFile> {
      files.set(key, { body, contentType });
      return Promise.resolve({ key, url: `https://files.test/files/${key}` });
    },

    delete(key: string): Promise<void> {
      files.delete(key);
      return Promise.resolve();
    },
  };
}
