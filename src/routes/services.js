'use strict';

const express = require('express');

const { getServices, getServiceDetail } = require('../controllers/serviceController');

const router = express.Router();

// Public by design -- see the comment at the top of serviceController.js. Visibility is
// enforced in the SQL, not by a guard here.
router.get('/services', getServices);
router.get('/services/:id', getServiceDetail);

module.exports = router;
