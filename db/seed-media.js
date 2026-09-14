'use strict';




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


const INK = '#12212b';
const PRIMARY = '#0b5d6b';
const SURFACE = '#e7eef0';


function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270" role="img">
  <rect width="480" height="270" fill="${SURFACE}"/>
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>`;
}

const ILLUSTRATIONS = {

  transport: svg(`    <path d="M120 168 h150 v-56 h48 l34 34 v22 h-22"/>
    <path d="M120 168 v-56 h150"/>
    <circle cx="168" cy="182" r="15"/>
    <circle cx="300" cy="182" r="15"/>
    <path d="M183 182 h102"/>
    <path d="M120 112 v56 l-52 30 h64" stroke="${PRIMARY}"/>
    <path d="M96 198 h72" stroke="${PRIMARY}"/>`),


  interpreter: svg(`    <circle cx="196" cy="70" r="22"/>
    <path d="M196 92 v26"/>
    <path d="M150 230 v-68 a46 46 0 0 1 92 0 v68z"/>
    <path d="M162 132 l-30 18 l-4 -42" stroke="${PRIMARY}"/>
    <path d="M230 132 l30 18 l4 -42" stroke="${PRIMARY}"/>
    <circle cx="128" cy="100" r="11" stroke="${PRIMARY}"/>
    <circle cx="264" cy="100" r="11" stroke="${PRIMARY}"/>
    <path d="M300 96 h64 a12 12 0 0 1 12 12 v40 a12 12 0 0 1 -12 12 h-38 l-20 20 v-20 h-6 a12 12 0 0 1 -12 -12 v-40 a12 12 0 0 1 12 -12z" stroke="${PRIMARY}"/>
    <path d="M318 122 h28 M318 140 h18" stroke="${PRIMARY}"/>`),


  caregiver: svg(`    <circle cx="186" cy="92" r="20"/>
    <path d="M186 112 v58 M186 170 l-18 44 M186 170 l18 44"/>
    <path d="M186 132 l34 20" stroke="${PRIMARY}"/>
    <circle cx="300" cy="104" r="18" stroke="${PRIMARY}"/>
    <path d="M300 122 v52 M300 174 l-16 40 M300 174 l16 40" stroke="${PRIMARY}"/>
    <path d="M300 140 l-46 12" stroke="${PRIMARY}"/>`),


  mobility: svg(`    <circle cx="232" cy="176" r="46"/>
    <circle cx="232" cy="176" r="10"/>
    <path d="M232 130 v92 M186 176 h92 M199 143 l66 66 M199 209 l66 -66"/>
    <circle cx="312" cy="200" r="18" stroke="${PRIMARY}"/>
    <path d="M232 130 h56 v46" stroke="${PRIMARY}"/>
    <path d="M288 176 h34" stroke="${PRIMARY}"/>
    <circle cx="256" cy="86" r="18" stroke="${PRIMARY}"/>`),


  other: svg(`    <rect x="132" y="80" width="216" height="132" rx="10"/>
    <path d="M204 212 v22 M276 212 v22 M186 234 h108"/>
    <path d="M162 128 h108 M162 156 h156 M162 184 h84" stroke="${PRIMARY}"/>`),
};



function digestOf(markup) {
  return crypto.createHash('sha256').update(markup).digest('hex');
}


async function storedDigest(key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

    return head.Metadata?.['content-sha256'] ?? '';
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}



function escapePdfText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}



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
