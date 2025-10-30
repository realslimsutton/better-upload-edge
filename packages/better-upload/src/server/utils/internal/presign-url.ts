/**
 * Creates a presigned URL for S3/R2 using AWS Signature Version 4 query string signing.
 * Compatible with Cloudflare Workers (uses Web Crypto API).
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
 * Creates a presigned URL for S3 operations using AWS Signature Version 4.
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
    metadata = {},
    acl,
    storageClass,
  } = params;

  // Normalize endpoint
  const normalizedEndpoint = endpoint.replace(/\/$/, '');

  // Use path-style for R2, MinIO, localhost
  const usePathStyle =
    normalizedEndpoint.includes('r2.cloudflarestorage.com') ||
    normalizedEndpoint.includes('localhost') ||
    normalizedEndpoint.includes('127.0.0.1') ||
    normalizedEndpoint.includes('minio') ||
    bucket.includes('.');

  const host = usePathStyle
    ? normalizedEndpoint.replace(/^https?:\/\//, '')
    : `${bucket}.${normalizedEndpoint.replace(/^https?:\/\//, '')}`;

  const path = usePathStyle ? `/${bucket}/${key}` : `/${key}`;

  // Canonical URI - encode each path segment
  const canonicalUri = path
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%2F/g, '/'))
    .join('/');

  // Build date strings
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replace(/:/g, '')}Z`;
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  // Build query parameters
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
  };

  // Add metadata
  Object.entries(metadata).forEach(([k, v]) => {
    if (v) queryParams[`x-amz-meta-${k.toLowerCase()}`] = v;
  });

  if (acl) {
    queryParams['x-amz-acl'] = acl;
  }

  if (storageClass) {
    queryParams['x-amz-storage-class'] = storageClass;
  }

  // Canonical query string
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => {
      const value = queryParams[k];
      return `${encodeURIComponent(k)}=${encodeURIComponent(value!)}`;
    })
    .join('&');

  // Canonical headers
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';

  // Canonical request
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  // String to sign
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  // Calculate signature
  const signature = await calculateSignature(
    secretAccessKey,
    dateStamp,
    region,
    stringToSign
  );

  // Add signature to query params
  queryParams['X-Amz-Signature'] = signature;

  // Build final URL
  const finalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => {
      const value = queryParams[k];
      return `${encodeURIComponent(k)}=${encodeURIComponent(value!)}`;
    })
    .join('&');

  const protocol = normalizedEndpoint.startsWith('https') ? 'https' : 'http';
  return `${protocol}://${host}${path}?${finalQueryString}`;
}

// Helper functions using Web Crypto API
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmac(
  key: ArrayBuffer | string,
  message: string
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData =
    typeof key === 'string'
      ? await crypto.subtle.importKey(
          'raw',
          encoder.encode(key),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        )
      : await crypto.subtle.importKey(
          'raw',
          key,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );

  return await crypto.subtle.sign('HMAC', keyData, encoder.encode(message));
}

async function calculateSignature(
  secretKey: string,
  dateStamp: string,
  region: string,
  stringToSign: string
): Promise<string> {
  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = await hmac(kSigning, stringToSign);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
