'use strict';

function deny(next, statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return next(error);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  if (req.method === 'GET' && req.accepts('html')) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }

  return deny(next, 401, 'You need to sign in to do that.');
}

function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles);

  return function roleGuard(req, res, next) {
    const user = req.session ? req.session.user : null;

    if (!user) {
      return deny(next, 401, 'You need to sign in to do that.');
    }

    if (!allowed.has(user.role)) {

      return deny(next, 403, 'Your account does not have access to that page.');
    }

    return next();
  };
}

function requireGuest(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireRole, requireGuest };
