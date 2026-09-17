'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');

const config = require('../config');

const COOKIE_NAME = 'bridgeability.csrf';
const FIELD_NAME = '_csrf';
const HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const COOKIE_OPTIONS = {

  httpOnly: true,
  sameSite: 'lax',
  secure: config.session.cookieSecure,
  path: '/',
};

function createToken() {
  return randomBytes(32).toString('base64url');
}

function tokensMatch(submitted, expected) {
  if (typeof submitted !== 'string' || typeof expected !== 'string') {
    return false;
  }

  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);

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
