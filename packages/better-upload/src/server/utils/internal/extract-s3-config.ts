/**
 * Extracts credentials and configuration from an S3Client.
 * Returns null if extraction fails (e.g., in Cloudflare Workers).
 */
export async function extractS3Config(client: any): Promise<{
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
} | null> {
  try {
    // Try to access the client's config
    // This works in Node.js environments
    const config = (client as any).config;
    if (!config) {
      return null;
    }

    // Get credentials
    const credentials = await config.credentials();
    if (!credentials?.accessKeyId || !credentials?.secretAccessKey) {
      return null;
    }

    // Get endpoint and region
    const endpoint =
      config.endpoint?.toString() ||
      config.endpointProvider?.({})?.url?.toString() ||
      `https://s3.${config.region || 'us-east-1'}.amazonaws.com`;

    const region = config.region || 'us-east-1';

    return {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      region,
      endpoint: endpoint.replace(/\/$/, ''),
    };
  } catch {
    // In Cloudflare Workers, S3Client won't work, so return null
    return null;
  }
}
