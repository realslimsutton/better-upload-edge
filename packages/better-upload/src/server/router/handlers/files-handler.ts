import { config } from '@/server/config';
import { RejectUpload } from '@/server/error';
import type { ObjectMetadata, Route } from '@/server/types/internal';
import type { S3Credentials } from '@/server/types/public';
import { isFileTypeAllowed } from '@/server/utils/internal/file-type';
import { createSlug } from '@/server/utils/internal/slug';
import type { UploadFileSchema } from '@/server/validations';
import type { S3Client } from '@aws-sdk/client-s3';
import { extractS3Config } from '@/server/utils/internal/extract-s3-config';
import { presignUrl } from '@/server/utils/internal/presign-url';

export async function handleFiles({
  req,
  client,
  credentials,
  defaultBucketName,
  route,
  data,
}: {
  req: Request;
  client?: S3Client;
  credentials?: S3Credentials;
  defaultBucketName: string;
  route: Route;
  data: UploadFileSchema;
}) {
  // Extract credentials - prefer provided credentials, fallback to extracting from client
  let s3Credentials: S3Credentials | null = credentials || null;

  if (!s3Credentials && client) {
    s3Credentials = await extractS3Config(client);
  }

  if (!s3Credentials) {
    throw new Error(
      'Either S3Client or credentials must be provided. For Cloudflare Workers, provide credentials directly.'
    );
  }
  const { files } = data;
  const maxFiles = route.maxFiles || config.defaultMaxFiles;
  const maxFileSize = route.maxFileSize || config.defaultMaxFileSize;

  const signedUrlExpiresIn =
    route.signedUrlExpiresIn || config.defaultSignedUrlExpiresIn;

  if (files.length > maxFiles) {
    return Response.json(
      {
        error: {
          type: 'too_many_files',
          message: 'Too many files.',
        },
      },
      { status: 400 }
    );
  }

  for (const file of files) {
    if (file.size > 1024 * 1024 * 5000) {
      return Response.json(
        {
          error: {
            type: 'file_too_large',
            message:
              'One or more files exceed the S3 limit of 5GB. Use multipart upload for larger files.',
          },
        },
        { status: 400 }
      );
    }

    if (file.size > maxFileSize) {
      return Response.json(
        {
          error: {
            type: 'file_too_large',
            message: 'One or more files are too large.',
          },
        },
        { status: 400 }
      );
    }

    if (route.fileTypes && !isFileTypeAllowed(file.type, route.fileTypes)) {
      return Response.json(
        {
          error: {
            type: 'invalid_file_type',
            message: 'One or more files have an invalid file type.',
          },
        },
        { status: 400 }
      );
    }
  }

  let interMetadata, bucketName, generateObjectInfoCallback;
  try {
    const onBeforeUpload = await route.onBeforeUpload?.({
      req,
      files,
      clientMetadata: data.metadata,
    });

    interMetadata = onBeforeUpload?.metadata || {};
    bucketName = onBeforeUpload?.bucketName || defaultBucketName;
    generateObjectInfoCallback = onBeforeUpload?.generateObjectInfo || null;
  } catch (error) {
    if (error instanceof RejectUpload) {
      return Response.json(
        { error: { type: 'rejected', message: error.message } },
        { status: 400 }
      );
    }

    throw error;
  }

  const signedUrls = await Promise.all(
    files.map(async (file) => {
      let objectKey = `${crypto.randomUUID()}-${createSlug(file.name)}`;
      let objectMetadata = {} as ObjectMetadata;
      let objectAcl = undefined;
      let objectStorageClass = undefined;
      let objectCacheControl = undefined;

      if (generateObjectInfoCallback) {
        const objectInfo = await generateObjectInfoCallback({ file });

        if (objectInfo.key) {
          objectKey = objectInfo.key;
        }
        if (objectInfo.metadata) {
          objectMetadata = Object.fromEntries(
            Object.entries(objectInfo.metadata).map(([key, value]) => [
              key.toLowerCase(),
              value,
            ])
          );
        }

        objectAcl = objectInfo.acl;
        objectStorageClass = objectInfo.storageClass;
        objectCacheControl = objectInfo.cacheControl;
      }

      // Use presignUrl for Cloudflare Workers compatibility
      const signedUrl = await presignUrl({
        accessKeyId: s3Credentials.accessKeyId,
        secretAccessKey: s3Credentials.secretAccessKey,
        region: s3Credentials.region,
        endpoint: s3Credentials.endpoint,
        bucket: bucketName,
        key: objectKey,
        method: 'PUT',
        expiresIn: signedUrlExpiresIn,
        contentType: file.type,
        contentLength: file.size,
        metadata: objectMetadata,
        acl: objectAcl,
        storageClass: objectStorageClass,
        cacheControl: objectCacheControl,
        signableHeaders: objectCacheControl ? ['cache-control'] : [],
      });

      return {
        signedUrl,
        file: { ...file, objectKey, objectMetadata, objectCacheControl },
      };
    })
  );

  let responseMetadata;
  try {
    const onAfterSignedUrl = await route.onAfterSignedUrl?.({
      req,
      files: signedUrls.map(({ file }) => file),
      metadata: interMetadata,
      clientMetadata: data.metadata,
    });

    responseMetadata = onAfterSignedUrl?.metadata || {};
  } catch (error) {
    throw error;
  }

  return Response.json({
    files: signedUrls,
    metadata: responseMetadata,
  });
}
