'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const serviceRoutes = require('./routes/services');
const providerServiceRoutes = require('./routes/providerServices');
const bookingRoutes = require('./routes/bookings');
const providerBookingRoutes = require('./routes/providerBookings');
const adminProviderRoutes = require('./routes/adminProviders');
const adminReportRoutes = require('./routes/adminReports');
const sessionMiddleware = require('./middleware/session');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { asset } = require('./lib/assetVersion');

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
      // No ACM certificate is possible for the *.elasticbeanstalk.com CNAME (see
      // SESSION_COOKIE_SECURE in src/config), so this environment has no HTTPS listener.
      // Helmet's default upgrade-insecure-requests would rewrite every stylesheet and
      // script URL to https://, the browser would fail to connect, and the page would
      // render completely unstyled. null removes the inherited default rather than
      // overriding it. Restore this the moment a certificate is attached.
      upgradeInsecureRequests: null,
    },
  },
}));

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));
// Asset URLs carry a hash of their contents (see lib/assetVersion.js), so a changed file
// gets a new URL and an unchanged one keeps its old URL. That makes a long cache correct
// rather than dangerous: `immutable` tells the browser not even to revalidate.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1y', immutable: true }));

// Safe view defaults, set before anything that can fail.
//
// EJS raises a ReferenceError for a name that is not in scope, so if the session or CSRF
// layer throws, the error page itself would fail to render and the user would get a blank
// 500. Seeding the locals here means the error view can always be drawn. The middleware
// below overwrite these with real values.
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.currentPath = req.path;
  res.locals.csrfToken = '';
  res.locals.flash = null;
  res.locals.asset = asset;
  next();
});

// Health is mounted before the session layer on purpose. The load balancer polls /health
// several times a minute and sends no cookie, so there is nothing for the session store to
// do; more importantly the probe must report on RDS, DynamoDB and S3 directly rather than
// through another layer that could fail independently.
app.use(healthRoutes);

app.use(cookieParser());
app.use(sessionMiddleware);
app.use(csrfProtection);

// Real view values, now that the session exists. csrfProtection has already set
// res.locals.csrfToken.
app.use((req, res, next) => {
  // Rendered pages are never stored. A page rendered for a signed-in user must not be
  // readable from the cache by pressing Back after sign-out, which matters most on the
  // shared and public machines a lot of our users rely on. Static assets are unaffected --
  // they are served above, before this runs.
  res.set('Cache-Control', 'no-store');

  res.locals.user = req.session.user || null;

  // Flash messages survive exactly one redirect: read here and removed, so a success notice
  // does not reappear when the user refreshes the page they landed on.
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) {
    delete req.session.flash;
  }

  next();
});

app.get('/', (req, res) => {
  res.render('home', { title: 'Accessibility services, booked in one place' });
});

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(serviceRoutes);
app.use(providerServiceRoutes);
app.use(bookingRoutes);
app.use(providerBookingRoutes);
app.use(adminProviderRoutes);
app.use(adminReportRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
