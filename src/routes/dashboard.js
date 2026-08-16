'use strict';

const express = require('express');

const { getDashboard } = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/authorize');

const router = express.Router();

router.get('/dashboard', requireAuth, getDashboard);

module.exports = router;
