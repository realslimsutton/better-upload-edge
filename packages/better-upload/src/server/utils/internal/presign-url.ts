import { AwsClient } from 'aws4fetch';

/**
 * Creates a presigned URL for S3 using AWS Signature Version 4 query string signing.
 * Compatible with Cloudflare Workers using aws4fetch.
 */

export interface PresignUrlParams {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  bucket: string;
  key: string;
  method?: string;
  expiresIn?: number;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  acl?: string;
  storageClass?: string;
  cacheControl?: string;
  signableHeaders?: string[];
}

/**
 * Creates a presigned URL for S3 operations using AWS Signature Version 4 via aws4fetch.
 */
export async function presignUrl(params: PresignUrlParams): Promise<string> {
  const {
    accessKeyId,
    secretAccessKey,
    region,
    endpoint,
    bucket,
    key,
    method = 'PUT',
    expiresIn = 120,
    contentType,
    contentLength,
    metadata = {},
    acl,
    storageClass,
    cacheControl,
  } = params;

  // Create aws4fetch client
  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region,
    service: 's3',
  });

  // Normalize endpoint (remove trailing slash)
  const normalizedEndpoint = endpoint.replace(/\/$/, '');

  // Determine if using path-style or virtual-hosted-style URLs
  // Use path-style for: localhost, MinIO, Cloudflare R2, or buckets with dots
  const usePathStyle =
    normalizedEndpoint.includes('localhost') ||
    normalizedEndpoint.includes('127.0.0.1') ||
    normalizedEndpoint.includes('minio') ||
    normalizedEndpoint.includes('r2.cloudflarestorage.com') ||
    bucket.includes('.');

  const host = usePathStyle
    ? normalizedEndpoint.replace(/^https?:\/\//, '')
    : `${bucket}.${normalizedEndpoint.replace(/^https?:\/\//, '')}`;

  const path = usePathStyle ? `/${bucket}/${key}` : `/${key}`;
  const protocol = normalizedEndpoint.startsWith('https') ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}${path}`;

  // Build URL with query parameters for presigned URL
  const url = new URL(baseUrl);
  url.searchParams.set('X-Amz-Expires', expiresIn.toString());

  // Add metadata as query parameters
  Object.entries(metadata).forEach(([k, v]) => {
    url.searchParams.set(`x-amz-meta-${k.toLowerCase()}`, v);
  });

  // Add S3-specific query parameters
  if (acl) {
    url.searchParams.set('x-amz-acl', acl);
  }

  if (storageClass) {
    url.searchParams.set('x-amz-storage-class', storageClass);
  }

  if (cacheControl) {
    url.searchParams.set('Cache-Control', cacheControl);
  }

  // For presigned URLs, we don't include content-type and content-length in the signature
  // The client will send them, but they're not part of the presigned URL signature
  // Create a Request object without body-related headers
  const request = new Request(url.toString(), {
    method,
  });

  // Sign the request with aws4fetch - use signQuery to create presigned URL
  const signedRequest = await aws.sign(request, {
    aws: { signQuery: true },
  });

  return signedRequest.url;
}
