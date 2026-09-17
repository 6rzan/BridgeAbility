'use strict';

require('../helpers/env');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  csrfProtection,
  rotateToken,
  tokensMatch,
  COOKIE_NAME,
} = require('../../src/middleware/csrf');

function makeRequest({ method = 'GET', cookies = {}, body = {}, headers = {} } = {}) {
  return {
    method,
    cookies,
    body,
    get: (name) => headers[name.toLowerCase()],
  };
}

function makeResponse() {
  const cookiesSet = {};
  return {
    locals: {},
    cookiesSet,
    cookie(name, value, options) {
      cookiesSet[name] = { value, options };
    },
  };
}

function run(req, res) {
  let captured = null;
  csrfProtection(req, res, (error) => { captured = error || null; });
  return captured;
}

test('tokensMatch rejects a mismatch, a length difference and a non-string', () => {
  assert.equal(tokensMatch('abc', 'abd'), false);
  assert.equal(tokensMatch('abc', 'abcd'), false);
  assert.equal(tokensMatch(undefined, 'abc'), false);
  assert.equal(tokensMatch('abc', undefined), false);
  assert.equal(tokensMatch('abc', 'abc'), true);
});

test('tokensMatch rejects two empty strings', () => {
  assert.equal(tokensMatch('', ''), false);
});

test('a GET issues a token and exposes it to the view', () => {
  const res = makeResponse();
  const error = run(makeRequest(), res);

  assert.equal(error, null);
  const issued = res.cookiesSet[COOKIE_NAME];
  assert.ok(issued, 'expected a CSRF cookie to be set');
  assert.equal(res.locals.csrfToken, issued.value);
  assert.ok(issued.value.length >= 32);
});

test('the CSRF cookie is HttpOnly and SameSite=Lax', () => {
  const res = makeResponse();
  run(makeRequest(), res);

  const { options } = res.cookiesSet[COOKIE_NAME];
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, 'lax');
});

test('a GET reuses an existing token rather than churning it every page', () => {
  const res = makeResponse();
  run(makeRequest({ cookies: { [COOKIE_NAME]: 'existing-token-value' } }), res);

  assert.equal(res.locals.csrfToken, 'existing-token-value');
  assert.equal(res.cookiesSet[COOKIE_NAME], undefined, 'should not have reissued');
});

test('a POST carrying the matching token in the body is allowed', () => {
  const error = run(
    makeRequest({
      method: 'POST',
      cookies: { [COOKIE_NAME]: 'token-abc' },
      body: { _csrf: 'token-abc' },
    }),
    makeResponse()
  );

  assert.equal(error, null);
});

test('a POST carrying the matching token in the header is allowed', () => {
  const error = run(
    makeRequest({
      method: 'POST',
      cookies: { [COOKIE_NAME]: 'token-abc' },
      headers: { 'x-csrf-token': 'token-abc' },
    }),
    makeResponse()
  );

  assert.equal(error, null);
});

test('a POST with the cookie but no submitted token is rejected with 403', () => {
  const error = run(
    makeRequest({ method: 'POST', cookies: { [COOKIE_NAME]: 'token-abc' }, body: {} }),
    makeResponse()
  );

  assert.ok(error);
  assert.equal(error.statusCode, 403);
});

test('a POST with a wrong token is rejected with 403', () => {
  const error = run(
    makeRequest({
      method: 'POST',
      cookies: { [COOKIE_NAME]: 'token-abc' },
      body: { _csrf: 'token-xyz' },
    }),
    makeResponse()
  );

  assert.ok(error);
  assert.equal(error.statusCode, 403);
});

test('a POST with no cookie at all is rejected', () => {
  const error = run(
    makeRequest({ method: 'POST', cookies: {}, body: { _csrf: 'token-abc' } }),
    makeResponse()
  );

  assert.ok(error);
  assert.equal(error.statusCode, 403);
});

test('every unsafe method is checked, not just POST', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const error = run(makeRequest({ method, cookies: {}, body: {} }), makeResponse());
    assert.ok(error, `${method} should have been rejected`);
  }
});

test('rotateToken replaces the token, so one issued before sign-in cannot be replayed after', () => {
  const req = makeRequest({ cookies: { [COOKIE_NAME]: 'pre-login-token' } });
  const res = makeResponse();

  const issued = rotateToken(req, res);

  assert.notEqual(issued, 'pre-login-token');
  assert.equal(res.cookiesSet[COOKIE_NAME].value, issued);
  assert.equal(res.locals.csrfToken, issued);
});
