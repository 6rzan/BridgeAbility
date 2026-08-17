'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');




const PUBLIC_ROOT = path.join(__dirname, '..', 'public');

const fingerprints = new Map();

function fingerprint(urlPath) {
  const absolute = path.join(PUBLIC_ROOT, urlPath.replace(/^\//, ''));

  if (!absolute.startsWith(PUBLIC_ROOT + path.sep)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(absolute);
    return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 10);
  } catch {

    console.warn('[assets] no such asset, serving unfingerprinted', { urlPath });
    return null;
  }
}



function asset(urlPath) {
  if (!fingerprints.has(urlPath)) {
    fingerprints.set(urlPath, fingerprint(urlPath));
  }

  const hash = fingerprints.get(urlPath);
  return hash ? `${urlPath}?v=${hash}` : urlPath;
}

module.exports = { asset };
