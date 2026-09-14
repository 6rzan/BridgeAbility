'use strict';

const express = require('express');

const {
  getQueue,
  getProviderDetail,
  postApprove,
  postReject,
} = require('../controllers/adminProviderController');
const { requireAuth, requireRole } = require('../middleware/authorize');



const router = express.Router();

router.use('/admin/providers', requireAuth, requireRole('admin'));

router.get('/admin/providers', getQueue);
router.get('/admin/providers/:id', getProviderDetail);
router.post('/admin/providers/:id/approve', postApprove);
router.post('/admin/providers/:id/reject', postReject);

module.exports = router;
