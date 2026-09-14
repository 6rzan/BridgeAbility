'use strict';

const express = require('express');

const {
  getQueue,
  getProviderDetail,
  postApprove,
  postReject,
} = require('../controllers/adminProviderController');
const { requireAuth, requireRole } = require('../middleware/authorize');

/**
 * Admin provider-review routes (F5).
 *
 * The guard is mounted on the whole router, the same shape as every other role-scoped router in
 * the application. Unlike providerServices.js or providerBookings.js there is no ownership
 * resolution in the controller behind it: any administrator may review any provider.
 */
const router = express.Router();

router.use('/admin/providers', requireAuth, requireRole('admin'));

router.get('/admin/providers', getQueue);
router.get('/admin/providers/:id', getProviderDetail);
router.post('/admin/providers/:id/approve', postApprove);
router.post('/admin/providers/:id/reject', postReject);

module.exports = router;
