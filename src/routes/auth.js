'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const authController = require('../controllers/authController');
const { requireAuth, requireGuest } = require('../middleware/authorize');

const router = express.Router();

/**
 * Rate limiting on the two routes that accept credentials.
 *
 * KNOWN LIMITATION, stated rather than hidden: express-rate-limit counts in the memory of one
 * Node process. Behind the load balancer in Phase F there are two instances, so the effective
 * ceiling across the environment is twice the number below, and a restart resets the counters.
 * Making it exact means a shared counter -- a DynamoDB item with an atomic ADD, which we
 * already have the table and the client for. It is out of scope for Task 1 and recorded in
 * docs/defect-log.md rather than quietly left as an unknown. What is here still defeats the
 * attack it is aimed at: an online password-guessing run against one account.
 */
const CREDENTIAL_WINDOW_MS = 15 * 60 * 1000;

function credentialLimiter(limit, message) {
  return rateLimit({
    windowMs: CREDENTIAL_WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Successful sign-ins are not counted, so a shared office address cannot lock itself out
    // through ordinary use; only failures consume the budget.
    skipSuccessfulRequests: true,
    handler: (req, res) => {
      res.status(429).render('error', {
        title: 'Too many attempts',
        statusCode: 429,
        message,
      });
    },
  });
}

const loginLimiter = credentialLimiter(
  10,
  'Too many sign-in attempts from this connection. Please wait 15 minutes and try again.'
);

const registerLimiter = credentialLimiter(
  5,
  'Too many accounts have been created from this connection. Please wait 15 minutes and try again.'
);

router.get('/login', requireGuest, authController.getLogin);
router.post('/login', requireGuest, loginLimiter, authController.postLogin);

router.get('/register', requireGuest, authController.getRegister);
router.post('/register', requireGuest, registerLimiter, authController.postRegister);

router.post('/logout', requireAuth, authController.postLogout);

module.exports = router;
