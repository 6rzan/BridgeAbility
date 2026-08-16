'use strict';

const express = require('express');

const {
  getIncomingQueue,
  getBookingDetail,
  postAccept,
  postReject,
} = require('../controllers/providerBookingController');
const { requireAuth, requireRole } = require('../middleware/authorize');

/**
 * Provider booking-decision routes (F4).
 *
 * The guard is mounted on the whole router, the same shape as providerServices.js, so a route
 * added later cannot be published unguarded by forgetting a check. requireProvider in the
 * controller is the second line: every query underneath is keyed on this provider's own
 * services, so even a mistake here cannot hand one organisation another organisation's requests.
 */
const router = express.Router();

router.use('/provider/bookings', requireAuth, requireRole('provider'));

router.get('/provider/bookings', getIncomingQueue);
router.get('/provider/bookings/:id', getBookingDetail);
router.post('/provider/bookings/:id/accept', postAccept);
router.post('/provider/bookings/:id/reject', postReject);

module.exports = router;
