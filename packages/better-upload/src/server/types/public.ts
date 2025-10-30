import type { S3Client } from '@aws-sdk/client-s3';
import type { ExecRoute } from './internal';

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
}

export type Router = {
  /**
   * The S3 client (for Node.js environments) or credentials (for Cloudflare Workers).
   *
   * For Cloudflare Workers, pass credentials directly instead of an S3Client.
   */
  client: S3Client | S3Credentials;

  /**
   * The name of the bucket where the files will be uploaded to.
   */
  bucketName: string;

  /**
   * The routes where files can be uploaded to.
   */
  routes: {
    [key: string]: ExecRoute;
  };
};
