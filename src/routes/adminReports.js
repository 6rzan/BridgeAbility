'use strict';

const express = require('express');

const { getReport } = require('../controllers/adminReportController');
const { requireAuth, requireRole } = require('../middleware/authorize');



const router = express.Router();

router.use('/admin/reports', requireAuth, requireRole('admin'));

router.get('/admin/reports', getReport);

module.exports = router;
