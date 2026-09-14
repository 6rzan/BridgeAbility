'use strict';

const session = require('express-session');

const DynamoSessionStore = require('../data/dynamo/sessionStore');
const config = require('../config');



module.exports = session({

  name: 'bridgeability.sid',
  store: new DynamoSessionStore(),
  secret: config.session.secret,


  resave: false,
  saveUninitialized: false,


  rolling: true,


  proxy: true,

  cookie: {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: 'lax',
    maxAge: config.session.ttlSeconds * 1000,
    path: '/',
  },
});
