import type { S3Client } from '@aws-sdk/client-s3';
import type { Router, S3Credentials } from '../types/public';
import { extractS3Config } from '../utils/internal/extract-s3-config';
import { standardValidate } from '../utils/internal/standard-schema';
import { uploadFileSchema } from '../validations';
import { handleFiles } from './handlers/files-handler';

export async function handleRequest(req: Request, router: Router) {
  if (req.method !== 'POST') {
    return Response.json(
      {
        error: {
          type: 'invalid_request',
          message: 'Method not allowed.',
        },
      },
      { status: 405 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    return Response.json(
      {
        error: {
          type: 'invalid_request',
          message: 'Invalid JSON body.',
        },
      },
      { status: 400 }
    );
  }

  const parsed = uploadFileSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          type: 'invalid_request',
          message: 'Invalid file upload schema.',
        },
      },
      { status: 400 }
    );
  }

  if (!(parsed.data.route in router.routes)) {
    return Response.json(
      {
        error: {
          type: 'invalid_request',
          message: 'Upload route not found.',
        },
      },
      { status: 404 }
    );
  }

  const route = router.routes[parsed.data.route]!();

  if (route.maxFiles === 1 && parsed.data.files.length > 1) {
    return Response.json(
      {
        error: {
          type: 'too_many_files',
          message: 'Multiple files are not allowed.',
        },
      },
      { status: 400 }
    );
  }

  let clientMetadata = parsed.data.metadata;
  if (route.clientMetadataSchema) {
    const validation = await standardValidate(
      route.clientMetadataSchema,
      clientMetadata
    );

    if (validation.issues) {
      return Response.json(
        {
          error: {
            type: 'invalid_request',
            message: 'Invalid metadata.',
          },
        },
        { status: 400 }
      );
    }
  }

  const data = {
    ...parsed.data,
    metadata: clientMetadata,
  };

  // Extract credentials - handle both S3Client and direct credentials
  let credentials: S3Credentials | undefined;
  let client: S3Client | undefined;

  if ('accessKeyId' in router.client) {
    // Direct credentials provided (for Cloudflare Workers)
    credentials = router.client as S3Credentials;
  } else {
    // S3Client provided (for Node.js environments)
    client = router.client as S3Client;
    credentials = (await extractS3Config(client)) || undefined;
  }

  // if (route.multipart) {
  //   return handleMultipartFiles({
  //     req,
  //     client: client,
  //     defaultBucketName: router.bucketName,
  //     route,
  //     data,
  //   });
  // }

  return handleFiles({
    req,
    client: client,
    credentials: credentials,
    defaultBucketName: router.bucketName,
    route,
    data,
  });
}
