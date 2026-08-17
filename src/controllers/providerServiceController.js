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


function formModel(extra) {
  return {
    categories: CATEGORY_LABELS,
    days: DAYS,
    errors: {},

    imageErrors: {},
    pageScript: ['form-validate.js', 'listing-image.js'],
    ...extra,
  };
}


function parseServiceId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}


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


    return res.redirect(`/provider/services/${serviceId}/edit`);
  } catch (error) {
    return next(error);
  }
}


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


async function postVisibility(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();


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


async function postDeleteListing(req, res, next) {
  try {
    const provider = await requireProvider(req, next);
    if (!provider) return undefined;

    const serviceId = parseServiceId(req.params.id);
    if (!serviceId) return next();

    const result = await providerListingService.remove(serviceId, provider.provider_id);

    if (result.outcome === 'not-found') return next();

    if (result.outcome === 'has-bookings') {

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
