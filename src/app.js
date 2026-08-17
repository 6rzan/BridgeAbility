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
const coordinatorBookingRoutes = require('./routes/coordinatorBookings');
const sessionMiddleware = require('./middleware/session');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { asset } = require('./lib/assetVersion');

const app = express();


app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],

      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],

      upgradeInsecureRequests: null,
    },
  },
}));

app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1y', immutable: true }));


app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.currentPath = req.path;
  res.locals.csrfToken = '';
  res.locals.flash = null;
  res.locals.asset = asset;
  next();
});


app.use(healthRoutes);

app.use(cookieParser());
app.use(sessionMiddleware);
app.use(csrfProtection);


app.use((req, res, next) => {

  res.set('Cache-Control', 'no-store');

  res.locals.user = req.session.user || null;


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
app.use(coordinatorBookingRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
