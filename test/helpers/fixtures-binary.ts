/** Real file headers, so byte-level type detection sees what it would in production. */

/** A 1x1 PNG. */
export function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

/** A minimal but structurally valid PDF. */
export function pdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'ascii');
}

/** Not any allowed format, whatever the request claims. */
export function textBytes(): Buffer {
  return Buffer.from('This is a plain text file, not an image.', 'utf8');
}

/** A PNG padded past a byte limit. */
export function oversizedPng(totalBytes: number): Buffer {
  return Buffer.concat([pngBytes(), Buffer.alloc(totalBytes)]);
}
