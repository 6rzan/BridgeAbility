'use strict';

const providerListingService = require('../services/providerListingService');
const { fieldErrors } = require('../validation/authSchemas');
const {
  listingSchema,
  uploadRequestSchema,
  imageConfirmSchema,
  CATEGORY_LABELS,
  DAYS,
} = require('../validation/providerServiceSchemas');

/**
 * F3 — a provider creates and manages their service listings.
 *
 * Every route below is mounted behind requireRole('provider') and every one of them resolves
 * the provider record from `req.session.user.id` before it touches a listing. No route takes a
 * provider id from a URL, a form field or a header, so there is no parameter anywhere in this
 * slice that can be edited to reach another organisation's listings.
 *
 * A listing that belongs to somebody else is answered 404, not 403 — the same choice, for the
 * same reason, as the booking detail page. "Forbidden" would confirm that service 7 exists and
 * belongs to a competitor, which is not something a provider is entitled to learn by typing
 * numbers into the address bar.
 */

/**
 * Resolve the signed-in user's provider record.
 *
 * A provider user with no providers row cannot happen through registration — the two inserts
 * share a transaction (userRepository.insertProvider) — but if it ever did, every page in this
 * slice would fail on a null dereference somewhere less obvious. Answering here, once, keeps
 * that from being eight separate crashes.
 */
async function requireProvider(req, next) {
  const provider = await providerListingService.findProvider(req.session.user.id);

  if (!provider) {
    const error = new Error('Your account is not linked to an organisation.');
    error.statusCode = 403;
    next(error);
    return null;
  }

  return provider;
}

/** Empty values for the create form, and for re-rendering one that failed validation. */
function blankListing() {
  return {
    title: '',
    category: '',
    description: '',
    price: '',
    location: '',
    days: [],
    hours: '',
  };
}

/** The values a submitted form carried, so a failed submission is never retyped from scratch. */
function submittedValues(body) {
  return {
    title: body.title || '',
    category: body.category || '',
    description: body.description || '',
    price: body.price || '',
    location: body.location || '',
    days: Array.isArray(body.days) ? body.days : (body.days ? [body.days] : []),
    hours: body.hours || '',
  };
}

/** An existing listing in the shape the form renders. */
function listingToValues(listing) {
  return {
    title: listing.title,
    category: listing.category,
    description: listing.description || '',
    price: listing.price,
    location: listing.location,
    days: listing.availability ? listing.availability.days : [],
    hours: listing.availability && listing.availability.hours ? listing.availability.hours : '',
  };
}

/** Everything both renderings of the form need. */
function formModel(extra) {
  return {
    categories: CATEGORY_LABELS,
    days: DAYS,
    errors: {},
    // Kept separate from `errors` so a problem with the alt text does not make the listing
    // form's own error summary claim the price or the title is wrong.
    imageErrors: {},
    pageScript: ['form-validate.js', 'listing-image.js'],
    ...extra,
  };
}

/** A listing id from the URL. Anything that is not a positive integer is simply not a listing. */
function parseServiceId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /provider/services — everything this organisation offers, published or withdrawn. */
async function getListings(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const { listings, counts } = await providerListingService.listOwn(provider.provider_id);

    return res.render('provider/services/index', {
      title: 'My listings',
      provider,
      listings,
      counts,
    });
  } catch (error) {
    return next(error);
  }
}

/** GET /provider/services/new — the create form. */
async function getNewListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    return res.render('provider/services/form', formModel({
      title: 'Add a listing',
      provider,
      listing: null,
      values: blankListing(),
    }));
  } catch (error) {
    return next(error);
  }
}

/** POST /provider/services — publish a new listing. */
async function postListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const parsed = listingSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(422).render('provider/services/form', formModel({
        title: 'Add a listing',
        provider,
        listing: null,
        values: submittedValues(req.body),
        errors: fieldErrors(parsed.error),
      }));
    }

    const { serviceId } = await providerListingService.create(provider.provider_id, parsed.data);

    req.session.flash = {
      type: 'success',
      message: provider.status === 'approved'
        ? 'Listing published. Requesters can find it now.'
        : 'Listing saved. It becomes visible to requesters once your organisation is approved.',
    };

    // Straight to the edit page rather than back to the list, because adding the image is the
    // next thing the provider wants to do and it can only happen once the listing has an id.
    return res.redirect(`/provider/services/${serviceId}/edit`);
  } catch (error) {
    return next(error);
  }
}

/** GET /provider/services/:id/edit — edit one listing and manage its image. */
async function getEditListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const listing = await providerListingService.findOwn(serviceId, provider.provider_id);
    if (!listing) return next();

    return res.render('provider/services/form', formModel({
      title: `Edit ${listing.title}`,
      provider,
      listing,
      values: listingToValues(listing),
    }));
  } catch (error) {
    return next(error);
  }
}

/** POST /provider/services/:id — save an edit. */
async function postEditListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const parsed = listingSchema.safeParse(req.body);

    if (!parsed.success) {
      const listing = await providerListingService.findOwn(serviceId, provider.provider_id);
      if (!listing) return next();

      return res.status(422).render('provider/services/form', formModel({
        title: `Edit ${listing.title}`,
        provider,
        listing,
        values: submittedValues(req.body),
        errors: fieldErrors(parsed.error),
      }));
    }

    const { outcome } = await providerListingService.update(
      serviceId,
      provider.provider_id,
      parsed.data
    );

    if (outcome === 'not-found') return next();

    req.session.flash = { type: 'success', message: 'Listing updated.' };
    return res.redirect(`/provider/services/${serviceId}/edit`);
  } catch (error) {
    return next(error);
  }
}

/** POST /provider/services/:id/visibility — withdraw a listing, or publish it again. */
async function postVisibility(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    // The button says which way it is going; anything else is treated as a withdrawal, which
    // is the reversible direction and therefore the safe reading of a malformed request.
    const publish = req.body.action === 'publish';

    const { outcome } = await providerListingService.setVisibility(
      serviceId,
      provider.provider_id,
      publish
    );

    if (outcome === 'not-found') return next();

    req.session.flash = outcome === 'published'
      ? { type: 'success', message: 'Listing published. It is back in the catalogue.' }
      : {
        type: 'success',
        message: 'Listing withdrawn. Requesters can no longer find or book it; bookings already '
          + 'made against it are unaffected.',
      };

    return res.redirect('/provider/services');
  } catch (error) {
    return next(error);
  }
}

/** POST /provider/services/:id/delete — delete a listing nobody has booked. */
async function postDeleteListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const result = await providerListingService.remove(serviceId, provider.provider_id);

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'has-bookings') {
      // Not an error page: the provider asked for something reasonable and the answer is a
      // different action, so say which one and leave them where they were.
      req.session.flash = {
        type: 'error',
        message: `This listing cannot be deleted — ${result.bookingCount} booking`
          + `${result.bookingCount === 1 ? ' has' : 's have'} been made against it. `
          + 'Withdraw it instead: it leaves the catalogue and those bookings stay intact.',
      };
      return res.redirect('/provider/services');
    }

    req.session.flash = { type: 'success', message: 'Listing deleted.' };
    return res.redirect('/provider/services');
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /provider/services/:id/image/presign — mint a presigned PUT.
 *
 * The only JSON endpoint in the slice. It answers the upload script, which then sends the file
 * to S3 itself; nothing here reads a file. Errors are JSON too, because the caller is a
 * `fetch` that needs a message to show, not a rendered page.
 */
async function postImagePresign(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return res.status(404).json({ error: 'That listing does not exist.' });

    const parsed = uploadRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      const errors = fieldErrors(parsed.error);
      return res.status(422).json({ error: errors.contentType || errors.contentLength });
    }

    const result = await providerListingService.presignImageUpload({
      serviceId,
      providerId: provider.provider_id,
      contentType: parsed.data.contentType,
      contentLength: parsed.data.contentLength,
    });

    if (result.outcome === 'not-found') {
      return res.status(404).json({ error: 'That listing does not exist.' });
    }

    return res.json({ uploadUrl: result.uploadUrl, key: result.key });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /provider/services/:id/image — record an upload that has landed.
 *
 * A normal form post rather than JSON, so the page reloads and shows the new image with the
 * flash message every other action in the slice uses. The script fills the hidden key field
 * and submits this form; there is one code path, not two.
 */
async function postImageConfirm(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const parsed = imageConfirmSchema.safeParse(req.body);

    if (!parsed.success) {
      const listing = await providerListingService.findOwn(serviceId, provider.provider_id);
      if (!listing) return next();

      return res.status(422).render('provider/services/form', formModel({
        title: `Edit ${listing.title}`,
        provider,
        listing,
        values: listingToValues(listing),
        imageErrors: fieldErrors(parsed.error),
      }));
    }

    const result = await providerListingService.confirmImage({
      serviceId,
      providerId: provider.provider_id,
      key: parsed.data.key,
      altText: parsed.data.altText,
    });

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'invalid-key') {
      // The key did not name this provider's own listing. Either the upload was tampered with
      // or the form was replayed against another listing; neither is worth explaining.
      req.session.flash = {
        type: 'error',
        message: 'That image could not be attached. Please choose the file again.',
      };
      return res.redirect(`/provider/services/${serviceId}/edit`);
    }

    req.session.flash = { type: 'success', message: 'Image added to the listing.' };
    return res.redirect(`/provider/services/${serviceId}/edit`);
  } catch (error) {
    return next(error);
  }
}

/** POST /provider/services/:id/image/remove — take the image off and delete the object. */
async function postImageRemove(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const { outcome } = await providerListingService.removeImage(serviceId, provider.provider_id);

    if (outcome === 'not-found') return next();

    req.session.flash = { type: 'success', message: 'Image removed from the listing.' };
    return res.redirect(`/provider/services/${serviceId}/edit`);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
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
  blankListing,
  submittedValues,
  listingToValues,
  parseServiceId,
};
