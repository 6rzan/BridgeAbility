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



const router = express.Router();

const REQUESTER_PATHS = ['/bookings', '/services/:id/book'];

router.use(REQUESTER_PATHS, requireAuth, requireRole('requester'));

router.get('/services/:id/book', getBookingForm);
router.post('/bookings', postBooking);
router.get('/bookings', getBookings);
router.get('/bookings/:id', getBookingDetail);
router.post('/bookings/:id/cancel', postCancel);

module.exports = router;
