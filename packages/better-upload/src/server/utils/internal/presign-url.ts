/**
 * Creates a presigned URL for S3 using AWS Signature Version 4 query string signing.
 * Compatible with Cloudflare Workers.
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
    contentType,
    contentLength,
    metadata = {},
    acl,
    storageClass,
    cacheControl,
    signableHeaders = [],
  } = params;

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

  // Build query parameters
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replace(/:/g, '')}Z`;
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
  };

  // Add metadata headers
  Object.entries(metadata).forEach(([k, v]) => {
    const headerKey = `x-amz-meta-${k.toLowerCase()}`;
    queryParams[headerKey] = v;
  });

  // Build headers that will be signed
  const headers: Record<string, string> = {
    host,
  };

  if (contentType) {
    headers['content-type'] = contentType;
  }

  if (contentLength !== undefined) {
    headers['content-length'] = contentLength.toString();
  }

  if (cacheControl && signableHeaders.includes('cache-control')) {
    headers['cache-control'] = cacheControl;
    queryParams['Cache-Control'] = cacheControl;
  }

  if (acl) {
    queryParams['x-amz-acl'] = acl;
  }

  if (storageClass) {
    queryParams['x-amz-storage-class'] = storageClass;
  }

  // Build canonical request
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k.toLowerCase()}:${headers[k]}`)
    .join('\n');
  const signedHeaders = Object.keys(headers)
    .sort()
    .map((k) => k.toLowerCase())
    .join(';');

  // Build query string (sorted)
  const queryString = Object.keys(queryParams)
    .sort()
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`
    )
    .join('&');

  const canonicalRequest = [
    method,
    path,
    queryString,
    canonicalHeaders,
    '',
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  // Create string to sign
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256(canonicalRequest),
  ].join('\n');

  // Calculate signature
  const kDate = await hmacSha256Raw(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, 's3');
  const kSigning = await hmacSha256Raw(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  // Add signature to query params
  queryParams['X-Amz-Signature'] = signature;

  // Build final URL
  const finalQueryString = Object.keys(queryParams)
    .sort()
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`
    )
    .join('&');

  const protocol = normalizedEndpoint.startsWith('https') ? 'https' : 'http';
  return `${protocol}://${host}${path}?${finalQueryString}`;
}

// Helper functions for cryptographic operations using Web Crypto API
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Raw(
  key: string | ArrayBuffer,
  message: string
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  let keyData: CryptoKey;

  if (typeof key === 'string') {
    const keyBuffer = encoder.encode(key);
    keyData = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } else {
    keyData = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }

  const messageData = encoder.encode(message);
  return await crypto.subtle.sign('HMAC', keyData, messageData);
}

async function hmacSha256Hex(
  key: ArrayBuffer,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const messageData = encoder.encode(message);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    keyData,
    messageData
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
