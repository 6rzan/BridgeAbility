'use strict';

const userRepository = require('../data/mysql/userRepository');

/**
 * The signed-in landing page. Each role sees its own summary.
 *
 * Role tasks are added to this map by the functionality that implements them, so a link never
 * appears before the route behind it exists.
 */
const ROLE_SUMMARY = {
  requester: {
    heading: 'Requester',
    blurb: 'Search verified listings, send booking requests and follow each one through to completion.',
    tasks: [
      { href: '/services', label: 'Find services', description: 'Search verified listings by category, location and price.' },
      { href: '/bookings', label: 'My bookings', description: 'Track every request you have sent and cancel one the provider has not answered.' },
    ],
  },
  provider: {
    heading: 'Service provider',
    blurb: 'Publish the services your organisation offers and respond to incoming booking requests.',
    tasks: [
      { href: '/provider/services', label: 'My listings', description: 'Create, edit, withdraw and delete the services your organisation offers.' },
      { href: '/provider/bookings', label: 'Incoming requests', description: 'Accept or decline booking requests sent against your listings.' },
    ],
  },
  admin: {
    heading: 'Administrator',
    blurb: 'Review provider registrations before they become visible, and monitor activity across the platform.',
  },
  coordinator: {
    heading: 'Coordinator',
    blurb: 'Assign volunteer assistants to confirmed bookings and record how each one finished.',
  },
};

async function getDashboard(req, res, next) {
  try {
    // Re-read the user rather than trusting the session snapshot: a provider approved by an
    // administrator five minutes ago must see that here without signing out and back in.
    const record = await userRepository.findById(req.session.user.id);

    if (!record) {
      // The account was deleted while the session was alive. Nothing to show it, so end it.
      return req.session.destroy(() => res.redirect('/login'));
    }

    return res.render('dashboard', {
      title: 'Dashboard',
      summary: ROLE_SUMMARY[record.role],
      account: record,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getDashboard, ROLE_SUMMARY };
