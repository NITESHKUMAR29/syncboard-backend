import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { FileStorage, PutFileInput, StoredFile } from './file-storage.js';

export interface S3StorageConfig {
  bucket: string;
  region?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  endpoint?: string | undefined;
}

/** S3-compatible storage, used when STORAGE_BUCKET is set (A9). */
export function createS3FileStorage(config: S3StorageConfig): FileStorage {
  const client = new S3Client({
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    ...(config.accessKeyId && config.secretAccessKey
      ? {
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        }
      : {}),
  });

  const publicBase = config.endpoint
    ? `${config.endpoint.replace(/\/$/, '')}/${config.bucket}`
    : `https://${config.bucket}.s3.${config.region ?? 'us-east-1'}.amazonaws.com`;

  return {
    async put({ key, body, contentType }: PutFileInput): Promise<StoredFile> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );

      return { key, url: `${publicBase}/${key}` };
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
