'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');

const healthRoutes = require('./routes/health');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Beanstalk terminates TLS at the load balancer and proxies through nginx, so trust one hop.
// Without this, secure cookies and rate-limit client IPs would both be wrong behind the ALB.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// There are no inline scripts or styles anywhere in this app, so a plain 'self' policy holds
// without needing nonces or unsafe-inline.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      // Service images are fetched from S3 over short-lived presigned HTTPS URLs.
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// View defaults. Every template can rely on these existing, so no view needs a
// `typeof x !== 'undefined'` guard for them. Auth and CSRF replace the placeholders
// in Phase B; until then a view rendering the signed-out state is the correct behaviour.
app.use((req, res, next) => {
  res.locals.user = req.session ? req.session.user : null;
  res.locals.currentPath = req.path;
  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.flash = null;
  next();
});

app.use(healthRoutes);

app.get('/', (req, res) => {
  res.render('home', { title: 'Accessibility services, booked in one place' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
