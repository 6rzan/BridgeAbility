'use strict';

const authService = require('../services/authService');
const { loginSchema, registerSchema, fieldErrors } = require('../validation/authSchemas');
const { rotateToken } = require('../middleware/csrf');

/**
 * Registration, sign-in and sign-out.
 *
 * Cross-cutting work: every role reaches the application through these three routes.
 */

/** Promisified so the handlers below can stay linear instead of nesting callbacks. */
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Sign a user in.
 *
 * The session id is regenerated first. Without that, an attacker who plants a known session
 * id in the victim's browser before sign-in still holds a valid id afterwards -- session
 * fixation. Regenerating means the id the user is authenticated under is one that has never
 * been outside this server.
 */
async function establishSession(req, res, user) {
  const returnTo = req.session.returnTo;

  await regenerateSession(req);
  req.session.user = user;
  await saveSession(req);

  // A CSRF token issued to the anonymous visitor must not stay valid for the signed-in one.
  rotateToken(req, res);

  return typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/dashboard';
}

function getLogin(req, res) {
  res.render('auth/login', {
    title: 'Sign in',
    values: {},
    errors: {},
    pageScript: 'form-validate.js',
  });
}

async function postLogin(req, res, next) {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).render('auth/login', {
      title: 'Sign in',
      values: { email: req.body.email || '' },
      errors: fieldErrors(parsed.error),
      pageScript: 'form-validate.js',
    });
  }

  try {
    const user = await authService.verifyCredentials(parsed.data.email, parsed.data.password);

    if (!user) {
      // One message for both "no such account" and "wrong password", by design. Status 401
      // rather than 400: the request was well formed, the credentials were not accepted.
      return res.status(401).render('auth/login', {
        title: 'Sign in',
        values: { email: parsed.data.email },
        errors: { form: 'Those details did not match an account. Check the email address and password, then try again.' },
        pageScript: 'form-validate.js',
      });
    }

    const destination = await establishSession(req, res, user);
    req.session.flash = { type: 'success', message: `Signed in as ${user.name}.` };
    return res.redirect(destination);
  } catch (error) {
    return next(error);
  }
}

function getRegister(req, res) {
  res.render('auth/register', {
    title: 'Create an account',
    values: { role: 'requester' },
    errors: {},
    pageScript: 'form-validate.js',
  });
}

async function postRegister(req, res, next) {
  // Everything except the passwords is echoed back on failure, so a long form does not have
  // to be retyped. Passwords are never re-rendered into the HTML.
  const values = {
    fullName: req.body.fullName || '',
    email: req.body.email || '',
    role: req.body.role === 'provider' ? 'provider' : 'requester',
    phone: req.body.phone || '',
    accessibilityNeeds: req.body.accessibilityNeeds || '',
    orgName: req.body.orgName || '',
  };

  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).render('auth/register', {
      title: 'Create an account',
      values,
      errors: fieldErrors(parsed.error),
      pageScript: 'form-validate.js',
    });
  }

  try {
    const user = await authService.register(parsed.data);
    const destination = await establishSession(req, res, user);

    req.session.flash = user.role === 'provider'
      ? {
        type: 'success',
        message: 'Account created. Your organisation is pending administrator approval — '
          + 'you can add listings once it is approved.',
      }
      : { type: 'success', message: 'Account created. Welcome to BridgeAbility.' };

    return res.redirect(destination);
  } catch (error) {
    if (error instanceof authService.EmailInUseError) {
      return res.status(409).render('auth/register', {
        title: 'Create an account',
        values,
        errors: { email: error.message },
        pageScript: 'form-validate.js',
      });
    }
    return next(error);
  }
}

/**
 * Sign out. POST, never GET: a GET sign-out can be triggered by any image tag pointing at it,
 * and it is state-changing, so it takes a CSRF token like every other write.
 */
async function postLogout(req, res, next) {
  try {
    await destroySession(req);
    res.clearCookie('bridgeability.sid', { path: '/' });
    rotateToken(req, res);
    return res.redirect('/');
  } catch (error) {
    return next(error);
  }
}

module.exports = { getLogin, postLogin, getRegister, postRegister, postLogout };
