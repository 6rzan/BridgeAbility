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

/**
 * Provider listing management (F3).
 *
 * The two guards are applied to the whole `/provider` prefix rather than repeated per route,
 * so a route added to this file later cannot be published unguarded by forgetting one. They
 * are separate because they answer different questions: requireAuth sends a signed-out visitor
 * to sign in and brings them back here, while requireRole answers 403 to a requester or a
 * coordinator who is signed in but has no business here.
 *
 * Neither is the real defence. `provider_id` is resolved from the session inside every handler
 * and every statement in providerServiceRepository is keyed on it, so even a mistake in this
 * file cannot hand one organisation another organisation's listings.
 */
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
