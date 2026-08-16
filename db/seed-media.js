'use strict';

/**
 * Uploads one placeholder illustration per service category to S3.
 *
 * WHY THIS EXISTS. The seeded listings carried image keys such as
 * `services/service-4.jpg` for objects that were never uploaded, so every card in the
 * catalogue would have requested a presigned URL for a missing object and rendered a broken
 * image. Rather than delete the images from the seed and leave the presigned-GET path
 * unexercised until F3, this puts real objects in the bucket so the catalogue's S3 integration
 * is genuinely working end to end.
 *
 * These are honestly what they look like: authored line illustrations standing in for a
 * provider's own photograph, and the alt text applied by the matching patch in db/patches
 * describes the illustration rather than pretending it is a photo. Real images arrive through
 * the provider upload flow in F3, and the patch is written so it never overwrites one.
 *
 * WHERE IT RUNS. On the Elastic Beanstalk instance, from .ebextensions, using the instance
 * profile's temporary credentials -- the same rule as the database migrations. No AWS
 * credential is used from a laptop and none exists in this repository.
 *
 * Safe to run on every deploy: an object that is already present is skipped.
 */

const {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.S3_BUCKET;

const client = new S3Client({ region: REGION });

// The palette matches src/public/css/main.css, so an illustration sits in the page rather
// than on top of it. Contrast between the strokes and the ground is checked by
// scripts/check-contrast.js as part of the same palette.
const INK = '#12212b';
const PRIMARY = '#0b5d6b';
const SURFACE = '#e7eef0';

/** Frame every illustration identically so the cards line up. */
function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270" role="img">
  <rect width="480" height="270" fill="${SURFACE}"/>
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>`;
}

const ILLUSTRATIONS = {
  // A van in side view with its rear ramp lowered to the kerb.
  transport: svg(`    <path d="M120 168 h150 v-56 h48 l34 34 v22 h-22"/>
    <path d="M120 168 v-56 h150"/>
    <circle cx="168" cy="182" r="15"/>
    <circle cx="300" cy="182" r="15"/>
    <path d="M183 182 h102"/>
    <path d="M120 112 v56 l-52 30 h64" stroke="${PRIMARY}"/>
    <path d="M96 198 h72" stroke="${PRIMARY}"/>`),

  // Two hands mid-sign, with a speech mark to say that meaning is being carried.
  interpreter: svg(`    <path d="M176 196 v-44 a10 10 0 0 1 20 0 v-38 a10 10 0 0 1 20 0 v34"/>
    <path d="M216 148 a10 10 0 0 1 20 0 v14"/>
    <path d="M236 162 a10 10 0 0 1 20 0 v34 a34 34 0 0 1 -34 34 h-12 a34 34 0 0 1 -34 -34"/>
    <path d="M300 96 h64 a12 12 0 0 1 12 12 v40 a12 12 0 0 1 -12 12 h-38 l-20 20 v-20 h-6 a12 12 0 0 1 -12 -12 v-40 a12 12 0 0 1 12 -12z" stroke="${PRIMARY}"/>
    <path d="M318 122 h28 M318 140 h18" stroke="${PRIMARY}"/>`),

  // One person steadying another by the arm.
  caregiver: svg(`    <circle cx="186" cy="92" r="20"/>
    <path d="M186 112 v58 M186 170 l-18 44 M186 170 l18 44"/>
    <path d="M186 132 l34 20" stroke="${PRIMARY}"/>
    <circle cx="300" cy="104" r="18" stroke="${PRIMARY}"/>
    <path d="M300 122 v52 M300 174 l-16 40 M300 174 l16 40" stroke="${PRIMARY}"/>
    <path d="M300 140 l-46 12" stroke="${PRIMARY}"/>`),

  // A manual wheelchair in side view.
  mobility: svg(`    <circle cx="232" cy="176" r="46"/>
    <circle cx="232" cy="176" r="10"/>
    <path d="M232 130 v92 M186 176 h92 M199 143 l66 66 M199 209 l66 -66"/>
    <circle cx="312" cy="200" r="18" stroke="${PRIMARY}"/>
    <path d="M232 130 h56 v46" stroke="${PRIMARY}"/>
    <path d="M288 176 h34" stroke="${PRIMARY}"/>
    <circle cx="256" cy="86" r="18" stroke="${PRIMARY}"/>`),

  // A screen showing live captions, standing in for the services that are none of the above.
  other: svg(`    <rect x="132" y="80" width="216" height="132" rx="10"/>
    <path d="M204 212 v22 M276 212 v22 M186 234 h108"/>
    <path d="M162 128 h108 M162 156 h156 M162 184 h84" stroke="${PRIMARY}"/>`),
};

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function main() {
  if (!BUCKET || !REGION) {
    throw new Error('S3_BUCKET and AWS_REGION must be set');
  }

  let uploaded = 0;
  let skipped = 0;

  for (const [category, markup] of Object.entries(ILLUSTRATIONS)) {
    const key = `services/placeholder-${category}.svg`;

    if (await objectExists(key)) {
      skipped += 1;
      continue;
    }

    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: markup,
      // Set explicitly: served through a presigned URL, the browser trusts this header, and
      // an SVG without it is offered as a download instead of rendering.
      ContentType: 'image/svg+xml',
      CacheControl: 'public, max-age=86400',
    }));

    uploaded += 1;
  }

  console.log(`[seed-media] ${uploaded} uploaded, ${skipped} already present`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[seed-media] FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = { ILLUSTRATIONS };
