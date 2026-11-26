import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { type BlobStore, blobContentType, checkBlob } from './store.ts';

export interface S3Options {
  /** The store's address, like `http://garage:3900`. Unset, AWS's own for `region`. */
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Blobs as objects in an S3 bucket (ADR 0004), each at its key: AWS's, or any store that speaks its
 * API, like Garage (the `s3` Compose profile). The bucket must exist, and its key be allowed to read,
 * write and delete objects in it. Nothing in it is ever public: the API serves every photo itself.
 */
export function createS3BlobStore({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
}: S3Options): BlobStore {
  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // The bucket in the path, not the host name, which stores other than AWS's often can't serve.
    forcePathStyle: true,
    // Without these, a store that stops answering holds each request that needs it for good.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
  });

  return {
    async put(key, body, { contentType }) {
      checkBlob(key, contentType);
      // A put is whole or not at all in S3, so no reader ever sees part of an object.
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      const contentType = blobContentType(key);
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!(object.Body instanceof Readable) || object.ContentLength === undefined) {
          throw new Error(`S3 sent no body or length for ${key}`);
        }
        return { body: object.Body, contentType, size: object.ContentLength };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },

    async delete(key) {
      blobContentType(key);
      // S3 answers the same whether the object was there or not.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
