'use strict';

const express = require('express');

const { getReport } = require('../controllers/adminReportController');
const { requireAuth, requireRole } = require('../middleware/authorize');

/**
 * Admin activity-report route (F6).
 *
 * Same guard shape as adminProviders.js: mounted on the whole router, no ownership resolution
 * behind it -- any administrator may read the whole platform's activity.
 */
const router = express.Router();

router.use('/admin/reports', requireAuth, requireRole('admin'));

router.get('/admin/reports', getReport);

module.exports = router;
