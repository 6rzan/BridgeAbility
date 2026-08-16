'use strict';

const express = require('express');

const {
  getQueue,
  getBookingDetail,
  postAssign,
  postUpdateCompletion,
} = require('../controllers/coordinatorBookingController');
const { requireAuth, requireRole } = require('../middleware/authorize');

/**
 * Coordinator booking routes (F7 assign, F8 completion).
 *
 * Same guard shape as adminProviders.js/adminReports.js: mounted on the whole router, no
 * ownership resolution behind it -- any coordinator may act on any booking.
 */
const router = express.Router();

router.use('/coordinator/bookings', requireAuth, requireRole('coordinator'));

router.get('/coordinator/bookings', getQueue);
router.get('/coordinator/bookings/:id', getBookingDetail);
router.post('/coordinator/bookings/:id/assign', postAssign);
router.post('/coordinator/bookings/:id/completion', postUpdateCompletion);

module.exports = router;
