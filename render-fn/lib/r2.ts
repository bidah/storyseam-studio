// Cloudflare R2 upload over the S3-compatible API, signed with aws4fetch.
// Mirrors shot-studio/server/index.js's R2 client exactly (env var names +
// endpoint shape), so the same credentials work here and in the Express server.

import { AwsClient } from "aws4fetch";

const R2 = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucket: process.env.R2_BUCKET,
  publicBase: (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
};

export function r2Configured(): boolean {
  return Boolean(
    R2.accountId && R2.accessKeyId && R2.secretAccessKey && R2.bucket && R2.publicBase
  );
}

let _client: AwsClient | null = null;
function r2Client(): AwsClient {
  if (!_client) {
    _client = new AwsClient({
      accessKeyId: R2.accessKeyId as string,
      secretAccessKey: R2.secretAccessKey as string,
      service: "s3",
      region: "auto",
    });
  }
  return _client;
}

// PUT raw bytes to R2 under `key`; returns the public URL.
export async function putToR2(
  key: string,
  body: ArrayBuffer | Uint8Array | Buffer,
  contentType = "video/mp4"
): Promise<string> {
  if (!r2Configured()) {
    throw new Error(
      "R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL"
    );
  }
  const cleanKey = String(key).replace(/^\/+/, "");
  const endpoint = `https://${R2.accountId}.r2.cloudflarestorage.com/${R2.bucket}/${cleanKey}`;
  const put = await r2Client().fetch(endpoint, {
    method: "PUT",
    body: body as BodyInit,
    headers: { "content-type": contentType },
  });
  if (!put.ok) {
    const detail = await put.text().catch(() => "");
    throw new Error(`R2 upload failed: ${put.status} ${detail.slice(0, 200)}`);
  }
  return `${R2.publicBase}/${cleanKey}`;
}
