'use strict';

const express = require('express');

const { getServices, getServiceDetail } = require('../controllers/serviceController');

const router = express.Router();


router.get('/services', getServices);
router.get('/services/:id', getServiceDetail);

module.exports = router;
