'use strict';

const express = require('express');

const {
  getBookingForm,
  postBooking,
  getBookings,
  getBookingDetail,
  postCancel,
} = require('../controllers/bookingController');
const { requireAuth, requireRole } = require('../middleware/authorize');

/**
 * Requester booking routes (F2).
 *
 * The guards are applied to the whole router rather than repeated on each route, so a route
 * added later cannot be published unguarded by forgetting one. Both are mounted, in order,
 * because they answer different questions: requireAuth sends a signed-out visitor to sign in
 * and returns them here afterwards, while requireRole answers 403 to someone who is signed in
 * as a provider or an administrator. Collapsing them would turn "please sign in" into
 * "you may not", which is both ruder and less true.
 *
 * The guards are not the only defence. Every query beneath is keyed on the signed-in
 * requester own id, so even a mistake in this file cannot hand one person another person
 * booking.
 */
const router = express.Router();

const REQUESTER_PATHS = ['/bookings', '/services/:id/book'];

router.use(REQUESTER_PATHS, requireAuth, requireRole('requester'));

router.get('/services/:id/book', getBookingForm);
router.post('/bookings', postBooking);
router.get('/bookings', getBookings);
router.get('/bookings/:id', getBookingDetail);
router.post('/bookings/:id/cancel', postCancel);

module.exports = router;
