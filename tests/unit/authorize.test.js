'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { requireAuth, requireRole, requireGuest } = require('../../src/middleware/authorize');

function makeRequest({ user = null, method = 'GET', originalUrl = '/dashboard' } = {}) {
  return {
    method,
    originalUrl,
    session: user ? { user } : {},
    accepts: () => true,
  };
}

function makeResponse() {
  const state = { redirectedTo: null };
  return {
    state,
    redirect(location) { state.redirectedTo = location; },
  };
}

/** Returns { passed, error, redirectedTo } for one middleware run. */
function run(middleware, req, res = makeResponse()) {
  let passed = false;
  let error = null;

  middleware(req, res, (maybeError) => {
    if (maybeError) {
      error = maybeError;
    } else {
      passed = true;
    }
  });

  return { passed, error, redirectedTo: res.state.redirectedTo };
}

const requester = { id: 1, name: 'Aisha', role: 'requester' };
const coordinator = { id: 10, name: 'Noor', role: 'coordinator' };

test('requireAuth lets a signed-in user through', () => {
  const result = run(requireAuth, makeRequest({ user: requester }));
  assert.equal(result.passed, true);
});

test('requireAuth sends an anonymous page request to sign in and remembers where it was going', () => {
  const req = makeRequest({ originalUrl: '/dashboard' });
  const result = run(requireAuth, req);

  assert.equal(result.redirectedTo, '/login');
  assert.equal(req.session.returnTo, '/dashboard');
});

test('requireAuth answers 401 to an anonymous write rather than redirecting it', () => {
  const result = run(requireAuth, makeRequest({ method: 'POST' }));

  assert.equal(result.error.statusCode, 401);
  assert.equal(result.redirectedTo, null);
});

// The point of the whole middleware: a signed-in user of the wrong role is stopped on the
// server. Whether the navigation shows them a link is irrelevant.
test('requireRole refuses a signed-in user whose role is not allowed', () => {
  const result = run(requireRole('coordinator'), makeRequest({ user: requester }));

  assert.equal(result.passed, false);
  assert.equal(result.error.statusCode, 403);
});

test('requireRole admits a user holding one of several allowed roles', () => {
  const guard = requireRole('admin', 'coordinator');

  assert.equal(run(guard, makeRequest({ user: coordinator })).passed, true);
  assert.equal(run(guard, makeRequest({ user: { ...requester, role: 'admin' } })).passed, true);
  assert.equal(run(guard, makeRequest({ user: requester })).passed, false);
});

// 401 and 403 must stay distinct: "we do not know who you are" is a different fix for the
// user than "we know, and you may not".
test('requireRole answers 401, not 403, when nobody is signed in', () => {
  const result = run(requireRole('admin'), makeRequest());
  assert.equal(result.error.statusCode, 401);
});

test('requireRole matches roles exactly and is not fooled by a near miss', () => {
  const guard = requireRole('admin');
  for (const role of ['administrator', 'Admin', 'admin ', '']) {
    assert.equal(run(guard, makeRequest({ user: { ...requester, role } })).passed, false, role);
  }
});

test('requireGuest passes anonymous visitors and redirects signed-in ones', () => {
  assert.equal(run(requireGuest, makeRequest()).passed, true);
  assert.equal(run(requireGuest, makeRequest({ user: requester })).redirectedTo, '/dashboard');
});
