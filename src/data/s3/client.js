'use strict';

const { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } =
  require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../../config');

/**
 * Shared S3 client and presigned-URL helpers.
 *
 * The bucket has Block Public Access fully enabled, so no object is ever reachable by URL
 * alone. The browser only ever receives a short-lived presigned URL minted here by the
 * backend using the instance profile's temporary credentials. When the URL expires the
 * object becomes unreachable again -- the bucket itself never changes.
 */
const client = new S3Client({ region: config.region });

/** Presign a time-limited download of a private object. */
function presignGet(key, ttlSeconds = config.s3.getTtlSeconds) {
  const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

/**
 * Presign a time-limited upload.
 *
 * `ContentType` and `ContentLength` are bound into the signature, so the browser cannot
 * upload a different type or a larger file than the server authorised.
 */
function presignPut(key, contentType, contentLength, ttlSeconds = config.s3.putTtlSeconds) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

/** Hard-delete an object. Used when a listing or a rejected verification document is removed. */
async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

/** Liveness probe used by /health. */
async function ping() {
  await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
}

module.exports = { client, presignGet, presignPut, deleteObject, ping };
