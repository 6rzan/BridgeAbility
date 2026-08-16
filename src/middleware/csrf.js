'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');

const config = require('../config');

/**
 * Double-submit CSRF protection.
 *
 * A random token is issued in its own cookie and the same value is rendered into every form
 * and into a <meta> tag for `fetch` callers. On an unsafe request the two must match. An
 * attacker's page can make the browser *send* our cookie, but the same-origin policy stops it
 * from *reading* the cookie or our HTML, so it cannot produce the matching body field.
 *
 * WHY THIS IS HAND-WRITTEN. The obvious choice, `csurf`, was deprecated by the Express team
 * in September 2022 and is no longer maintained; shipping an unmaintained security dependency
 * is worse than writing the thirty lines it replaces. The pattern is the one described in the
 * OWASP Cross-Site Request Forgery Prevention Cheat Sheet ("Naive Double-Submit Cookie"
 * hardened with an HttpOnly cookie and a server-rendered token).
 *
 * https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 * (accessed 16 August 2026)
 */

const COOKIE_NAME = 'bridgeability.csrf';
const FIELD_NAME = '_csrf';
const HEADER_NAME = 'x-csrf-token';

// RFC 9110 calls these safe: they must not change state, so they need no token. Everything
// else -- POST, PUT, PATCH, DELETE -- is checked.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const COOKIE_OPTIONS = {
  // The browser never needs to read this value: the server renders it into the page. Keeping
  // it HttpOnly means an XSS payload cannot lift the token straight out of document.cookie.
  httpOnly: true,
  sameSite: 'lax',
  secure: config.session.cookieSecure,
  path: '/',
};

function createToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time comparison. A plain `===` returns as soon as two strings differ, so the time
 * it takes leaks how many leading characters were correct.
 */
function tokensMatch(submitted, expected) {
  if (typeof submitted !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, and length is not a secret here.
  if (a.length !== b.length || a.length === 0) {
    return false;
  }

  return timingSafeEqual(a, b);
}

function submittedToken(req) {
  const fromBody = req.body ? req.body[FIELD_NAME] : undefined;
  return typeof fromBody === 'string' && fromBody.length > 0
    ? fromBody
    : req.get(HEADER_NAME);
}

/**
 * Issue a fresh token, replacing any existing one. Called on sign-in and sign-out: a token
 * that outlived a change of identity would let a token captured before login be replayed
 * after it.
 */
function rotateToken(req, res) {
  const token = createToken();
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.locals.csrfToken = token;
  return token;
}

function csrfProtection(req, res, next) {
  const cookieToken = req.cookies ? req.cookies[COOKIE_NAME] : undefined;

  if (SAFE_METHODS.has(req.method)) {
    res.locals.csrfToken = cookieToken || rotateToken(req, res);
    return next();
  }

  if (!cookieToken || !tokensMatch(submittedToken(req), cookieToken)) {
    // Most often a genuine user whose form sat open past the cookie's life, so the message
    // says what to do rather than accusing them of an attack.
    const error = new Error(
      'This form could not be submitted because its security token was missing or expired. '
      + 'Please go back, reload the page and try again.'
    );
    error.statusCode = 403;
    return next(error);
  }

  res.locals.csrfToken = cookieToken;
  return next();
}

module.exports = { csrfProtection, rotateToken, tokensMatch, COOKIE_NAME, FIELD_NAME };
