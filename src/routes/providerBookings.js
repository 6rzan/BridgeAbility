'use strict';

const express = require('express');

const {
  getIncomingQueue,
  getBookingDetail,
  postAccept,
  postReject,
} = require('../controllers/providerBookingController');
const { requireAuth, requireRole } = require('../middleware/authorize');



const router = express.Router();

router.use('/provider/bookings', requireAuth, requireRole('provider'));

router.get('/provider/bookings', getIncomingQueue);
router.get('/provider/bookings/:id', getBookingDetail);
router.post('/provider/bookings/:id/accept', postAccept);
router.post('/provider/bookings/:id/reject', postReject);

module.exports = router;
