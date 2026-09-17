import { fileTypeFromBuffer } from 'file-type';
import { FileTooLargeError, UnsupportedFileTypeError } from '../common/errors.js';

/**
 * Upload validation (Part B §7.5).
 *
 * The declared Content-Type and the file name are attacker-controlled, so the real type
 * is read from the file's leading bytes and that is what gets stored and served.
 */

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const ATTACHMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface ValidatedUpload {
  buffer: Buffer;
  /** Detected from the bytes, not from the request. */
  mimeType: string;
  sizeBytes: number;
}

export async function validateUpload(
  buffer: Buffer,
  allowedTypes: readonly string[],
  maxBytes: number,
): Promise<ValidatedUpload> {
  if (buffer.length === 0) {
    throw new UnsupportedFileTypeError('The uploaded file is empty');
  }

  if (buffer.length > maxBytes) {
    throw new FileTooLargeError(
      `File exceeds the ${String(Math.round(maxBytes / (1024 * 1024)))} MB limit`,
    );
  }

  const detected = await fileTypeFromBuffer(buffer);

  // Nothing recognisable means it is not one of the four formats we accept, whatever the
  // request claimed.
  if (!detected || !allowedTypes.includes(detected.mime)) {
    throw new UnsupportedFileTypeError(`Only ${allowedTypes.join(', ')} files are supported`);
  }

  return { buffer, mimeType: detected.mime, sizeBytes: buffer.length };
}
