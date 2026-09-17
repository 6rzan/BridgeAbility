'use strict';

const userRepository = require('../data/mysql/userRepository');

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
    tasks: [
      { href: '/admin/providers', label: 'Provider registrations', description: 'Approve or reject organisations before their listings become visible.' },
      { href: '/admin/reports', label: 'Activity reports', description: 'See bookings, provider registrations and volunteer assignments by status across the whole platform.' },
    ],
  },
  coordinator: {
    heading: 'Coordinator',
    blurb: 'Assign volunteer assistants to confirmed bookings and record how each one finished.',
    tasks: [
      { href: '/coordinator/bookings', label: 'Volunteer assignments', description: 'Assign a volunteer to a confirmed booking and log how it went.' },
    ],
  },
};

async function getDashboard(req, res, next) {
  try {

    const record = await userRepository.findById(req.session.user.id);

    if (!record) {

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
