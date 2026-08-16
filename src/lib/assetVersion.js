'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Content-fingerprinted URLs for static assets.
 *
 * THE BUG THIS FIXES, WHICH WAS LIVE
 *
 * Static files were served with a one-hour cache under a fixed URL. Deploy a change to
 * main.css and, for the next hour, a returning visitor gets the new HTML with the *old*
 * stylesheet out of their browser cache. That is not a subtle degradation -- new markup
 * against an old stylesheet renders as an unstyled list. It was caught exactly that way, by
 * opening the deployed catalogue in a browser and finding card styles missing while the
 * server was demonstrably serving a stylesheet that contained them.
 *
 * The fix is the standard one: put a hash of the file's contents in its URL. Change the file
 * and the URL changes, so the browser fetches it because it has never seen that URL before.
 * Leave the file alone and the URL is stable, so the cache still does its job. That makes it
 * safe to cache far more aggressively than an hour.
 *
 * Hashes are computed once at boot. The files cannot change under a running process -- a
 * deploy replaces the whole application directory and restarts it.
 */

const PUBLIC_ROOT = path.join(__dirname, '..', 'public');

const fingerprints = new Map();

function fingerprint(urlPath) {
  const absolute = path.join(PUBLIC_ROOT, urlPath.replace(/^\//, ''));

  // Refuse to read outside the public directory. The caller is always our own template today,
  // but a helper that turns a string into a file read gets reused, and this is one line.
  // The separator matters: without it a sibling directory named `publicdocs` would pass.
  if (!absolute.startsWith(PUBLIC_ROOT + path.sep)) {
    return null;
  }

  try {
    const contents = fs.readFileSync(absolute);
    return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 10);
  } catch {
    // A missing file is a broken reference, not a reason to fail the whole page. It will
    // 404 as it would have anyway, and the log says which one.
    console.warn('[assets] no such asset, serving unfingerprinted', { urlPath });
    return null;
  }
}

/**
 * `asset('/css/main.css')` -> `/css/main.css?v=1f4c0b8e2a`
 *
 * A query string rather than a rewritten filename, so the file on disk keeps its real name
 * and no build step or rewrite rule is needed to map the URL back to it.
 */
function asset(urlPath) {
  if (!fingerprints.has(urlPath)) {
    fingerprints.set(urlPath, fingerprint(urlPath));
  }

  const hash = fingerprints.get(urlPath);
  return hash ? `${urlPath}?v=${hash}` : urlPath;
}

module.exports = { asset };
