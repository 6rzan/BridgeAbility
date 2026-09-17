'use strict';

const express = require('express');

const {
  getQueue,
  getBookingDetail,
  postAssign,
  postUpdateCompletion,
} = require('../controllers/coordinatorBookingController');
const { requireAuth, requireRole } = require('../middleware/authorize');

const router = express.Router();

router.use('/coordinator/bookings', requireAuth, requireRole('coordinator'));

router.get('/coordinator/bookings', getQueue);
router.get('/coordinator/bookings/:id', getBookingDetail);
router.post('/coordinator/bookings/:id/assign', postAssign);
router.post('/coordinator/bookings/:id/completion', postUpdateCompletion);

module.exports = router;
