'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const authController = require('../controllers/authController');
const { requireAuth, requireGuest } = require('../middleware/authorize');

const router = express.Router();

const CREDENTIAL_WINDOW_MS = 15 * 60 * 1000;

function credentialLimiter(limit, message) {
  return rateLimit({
    windowMs: CREDENTIAL_WINDOW_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,

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
