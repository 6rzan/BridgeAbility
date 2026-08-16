'use strict';

const session = require('express-session');

const DynamoSessionStore = require('../data/dynamo/sessionStore');
const config = require('../config');

/**
 * Session middleware, stored in DynamoDB (see ../data/dynamo/sessionStore.js for why).
 *
 * The cookie holds only a signed session id. Nothing about the user -- not their role, not
 * their id -- is carried in the cookie, so a user cannot edit their way into another role.
 * Authorisation reads `req.session.user`, which lives server-side in DynamoDB.
 */
module.exports = session({
  // Renaming off the default `connect.sid` removes a free hint about the stack in use.
  name: 'bridgeability.sid',
  store: new DynamoSessionStore(),
  secret: config.session.secret,

  // The store is remote, so a write costs a network round trip. `resave: false` skips writing
  // sessions that did not change, and `saveUninitialized: false` means an anonymous visitor
  // who never signs in creates no DynamoDB item at all.
  resave: false,
  saveUninitialized: false,

  // Refresh the expiry on activity, so an eight-hour window is eight hours of inactivity
  // rather than a hard cut-off mid-task. Paired with the store's `touch`.
  rolling: true,

  // Beanstalk terminates the connection at the load balancer; `app.set('trust proxy', 1)`
  // in app.js plus this flag let express-session judge the protocol from X-Forwarded-Proto.
  proxy: true,

  cookie: {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: 'lax',
    maxAge: config.session.ttlSeconds * 1000,
    path: '/',
  },
});
