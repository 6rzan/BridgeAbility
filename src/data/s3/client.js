'use strict';

const { S3Client, HeadBucketCommand, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } =
  require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const AWSXRay = require('../../lib/xray');
const config = require('../../config');

const client = AWSXRay.captureAWSv3Client(new S3Client({ region: config.region }));

function presignGet(key, ttlSeconds = config.s3.getTtlSeconds) {
  const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

function presignPut(key, contentType, contentLength, ttlSeconds = config.s3.putTtlSeconds) {
  const command = new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }));
}

async function ping() {
  await client.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
}

module.exports = { client, presignGet, presignPut, deleteObject, ping };
