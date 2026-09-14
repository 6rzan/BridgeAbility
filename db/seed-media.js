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

const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

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

  // A person signing with both hands raised, beside a speech bubble.
  //
  // The first attempt at this drew a hand on its own with the digits stacked from the palm.
  // On a card at catalogue size it collapsed into one raised finger, which is a rude gesture
  // on a page about accessibility services and did not match its own alt text either. A whole
  // upper body carrying both hands cannot be misread that way, and no single part of it has
  // to survive being shrunk.
  interpreter: svg(`    <circle cx="196" cy="70" r="22"/>
    <path d="M196 92 v26"/>
    <path d="M150 230 v-68 a46 46 0 0 1 92 0 v68z"/>
    <path d="M162 132 l-30 18 l-4 -42" stroke="${PRIMARY}"/>
    <path d="M230 132 l30 18 l4 -42" stroke="${PRIMARY}"/>
    <circle cx="128" cy="100" r="11" stroke="${PRIMARY}"/>
    <circle cx="264" cy="100" r="11" stroke="${PRIMARY}"/>
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

/**
 * "Already uploaded" has to mean "already uploaded *this* drawing".
 *
 * The first version of this skipped any key that existed at all. That is wrong the moment an
 * illustration is corrected -- and one was, because the interpreter drawing collapsed into a
 * rude gesture at card size -- since the fix would sit in the repository and never reach the
 * bucket. Each object carries a sha256 of the markup that produced it, so a changed drawing
 * is re-uploaded and an unchanged one still costs a single HeadObject.
 */
function digestOf(markup) {
  return crypto.createHash('sha256').update(markup).digest('hex');
}

/** The digest recorded on the stored object, '' if it predates this scheme, null if absent. */
async function storedDigest(key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    // The SDK lower-cases user metadata keys on the way back out.
    return head.Metadata?.['content-sha256'] ?? '';
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Escape the three characters that are special inside a PDF literal string: a parenthesis
 * would otherwise close the string early and a backslash would start an escape.
 */
function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Build a small, genuinely valid one-page PDF -- not a text file wearing a .pdf extension.
 *
 * F5's admin document review opens this through a presigned GET in a new browser tab, so it
 * has to be bytes a PDF viewer actually renders, not merely an object that exists. Byte
 * offsets in the xref table are computed as the file is assembled rather than hand-counted,
 * so a wording change here can never desync them from the content.
 */
function buildPlaceholderPdf(lines) {
  const streamLines = lines
    .map((line, index) => `1 0 0 1 30 ${230 - index * 18} Tm (${escapePdfText(line)}) Tj`)
    .join('\n');
  const streamBody = `BT /F1 13 Tf\n${streamLines}\nET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 260] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}\nendstream`,
  ];

  const header = '%PDF-1.4\n';
  let body = '';
  const offsets = [];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(header + body, 'utf8'));
    body += `${offsets.length} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(header + body, 'utf8');
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, 'utf8');
}

/**
 * One placeholder verification document per provider that has a key on file (F5).
 *
 * The seeded `providers.verification_doc_s3_key` values point at objects nothing else ever
 * uploads, so an administrator's presigned GET signs successfully -- S3 only checks the
 * signature -- and 404s in the browser. Reading the keys straight from the database, rather
 * than assuming a naming pattern, means whatever is actually on each row gets a matching
 * object, backslash-typo'd keys included: the presign has to work for the key that is really
 * there, not the one we wish were there.
 *
 * DB_* is already sourced into this script's environment by 01-migrate.config, so this reuses
 * that connection shape rather than importing src/config (which expects the full application
 * environment, more than this standalone script needs).
 */
async function uploadVerificationDocuments() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let uploaded = 0;
  let replaced = 0;
  let skipped = 0;

  try {
    const [rows] = await connection.query(
      `SELECT org_name, verification_doc_s3_key
         FROM providers
        WHERE verification_doc_s3_key IS NOT NULL`
    );

    for (const row of rows) {
      const key = row.verification_doc_s3_key;
      const markup = buildPlaceholderPdf([
        'Placeholder verification document',
        row.org_name,
        'Seeded for demonstration -- not a real registration document.',
      ]);
      const digest = digestOf(markup);
      const existing = await storedDigest(key);

      if (existing === digest) {
        skipped += 1;
        continue;
      }

      await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: markup,
        ContentType: 'application/pdf',
        Metadata: { 'content-sha256': digest },
      }));

      if (existing === null) {
        uploaded += 1;
      } else {
        replaced += 1;
      }
    }
  } finally {
    await connection.end();
  }

  console.log(`[seed-media] verification docs: ${uploaded} uploaded, ${replaced} replaced, ${skipped} unchanged`);
}

async function main() {
  if (!BUCKET || !REGION) {
    throw new Error('S3_BUCKET and AWS_REGION must be set');
  }

  let uploaded = 0;
  let replaced = 0;
  let skipped = 0;

  for (const [category, markup] of Object.entries(ILLUSTRATIONS)) {
    const key = `services/placeholder-${category}.svg`;
    const digest = digestOf(markup);
    const existing = await storedDigest(key);

    if (existing === digest) {
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
      Metadata: { 'content-sha256': digest },
    }));

    if (existing === null) {
      uploaded += 1;
    } else {
      replaced += 1;
    }
  }

  console.log(`[seed-media] ${uploaded} uploaded, ${replaced} replaced, ${skipped} unchanged`);

  await uploadVerificationDocuments();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[seed-media] FAILED:', error.message);
      process.exit(1);
    });
}

module.exports = { ILLUSTRATIONS, buildPlaceholderPdf };
