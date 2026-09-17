'use strict';

const express = require('express');

const {
  getListings,
  getNewListing,
  postListing,
  getEditListing,
  postEditListing,
  postVisibility,
  postDeleteListing,
  postImagePresign,
  postImageConfirm,
  postImageRemove,
} = require('../controllers/providerServiceController');
const { requireAuth, requireRole } = require('../middleware/authorize');

const router = express.Router();

router.use('/provider', requireAuth, requireRole('provider'));

router.get('/provider/services', getListings);
router.get('/provider/services/new', getNewListing);
router.post('/provider/services', postListing);

router.get('/provider/services/:id/edit', getEditListing);
router.post('/provider/services/:id', postEditListing);
router.post('/provider/services/:id/visibility', postVisibility);
router.post('/provider/services/:id/delete', postDeleteListing);

router.post('/provider/services/:id/image/presign', postImagePresign);
router.post('/provider/services/:id/image', postImageConfirm);
router.post('/provider/services/:id/image/remove', postImageRemove);

module.exports = router;
