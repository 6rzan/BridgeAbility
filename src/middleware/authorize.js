'use strict';

/**
 * Server-side authentication and authorisation guards.
 *
 * Every protected route mounts one of these. Hiding a link in the navigation is presentation,
 * not access control -- a signed-in requester who types a coordinator's URL must be stopped
 * here, on the server, by a check that reads the role from the session rather than from
 * anything the browser sent. This is the implicit-deny principle from Chapter 4: a route is
 * closed unless a guard opens it for a named role.
 *
 * The role is read from `req.session.user`, which lives in DynamoDB. The browser holds only a
 * signed session id, so a user cannot rewrite their own role.
 */

function deny(next, statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return next(error);
}

/** Require any signed-in user. Sends anonymous visitors to sign in and back again. */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // Only same-site paths are remembered, so this cannot be turned into an open redirect.
  if (req.method === 'GET' && req.accepts('html')) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }

  return deny(next, 401, 'You need to sign in to do that.');
}

/**
 * Require one of the named roles. Always compose after requireAuth in the route definition,
 * so the two failure modes stay distinct: 401 means "we do not know who you are", 403 means
 * "we know, and you may not".
 */
function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);

  return function roleGuard(req, res, next) {
    const user = req.session ? req.session.user : null;

    if (!user) {
      return deny(next, 401, 'You need to sign in to do that.');
    }

    if (!allowed.has(user.role)) {
      // Deliberately vague: confirming that a coordinator-only page exists tells a prober
      // something about the system they cannot otherwise see.
      return deny(next, 403, 'Your account does not have access to that page.');
    }

    return next();
  };
}

/** For the sign-in and registration pages, which make no sense to an already-signed-in user. */
function requireGuest(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireRole, requireGuest };
