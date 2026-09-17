/**
 * File storage (A9).
 *
 * An interface with two implementations, so the project runs with nothing installed:
 * LocalFileStorage writes under ./uploads by default, and S3FileStorage is used when
 * STORAGE_BUCKET is set.
 */

export interface StoredFile {
  /** Opaque storage key, e.g. workspaces/{id}/tasks/{id}/{uuid}-{name}. */
  key: string;
  /** Where a client can fetch it. */
  url: string;
}

export interface PutFileInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface FileStorage {
  put(input: PutFileInput): Promise<StoredFile>;
  delete(key: string): Promise<void>;
}

/** Strips anything that could escape the storage prefix or confuse a filesystem. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');

  return cleaned.slice(0, 100) || 'file';
}
