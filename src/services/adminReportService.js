'use strict';

const reportRepository = require('../data/mysql/reportRepository');
const timelineRepository = require('../data/dynamo/timelineRepository');
const { formatWallClock, toKualaLumpur, STATUSES: BOOKING_STATUSES, STATUS_LABELS: BOOKING_STATUS_LABELS } = require('../validation/bookingSchemas');
const { PROVIDER_STATUSES, PROVIDER_STATUS_LABELS } = require('../validation/adminProviderSchemas');

/**
 * System-wide activity reports (F6).
 *
 * A read-only page: three RDS aggregates plus a DynamoDB query, run in parallel because none of
 * the four depends on another. Nothing here writes anything, so unlike every other service in
 * the application there is no repository call whose result gates a later one.
 *
 * completion_status's labels are defined here rather than imported from a validation module,
 * because F8 (which owns that enum end to end) does not exist yet at the point this file is
 * written. Three short strings duplicated once is cheaper than an import cycle waiting on work
 * that has not started.
 */

const COMPLETION_STATUSES = ['pending', 'in_progress', 'completed'];
const COMPLETION_LABELS = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const HOW_MANY_RECENT = 10;

/**
 * Fill in 0 for every key a GROUP BY did not return a row for.
 *
 * A status nobody has reached yet -- no assignment has ever been rejected, say -- is absent
 * from the query result entirely, not present with a zero. A summary panel built straight off
 * that result would silently drop a whole row rather than showing "0", which reads as the
 * status not existing at all. Used for all three summaries below.
 */
function withZeroCounts(keys, rawCounts) {
  const filled = { ...rawCounts };
  for (const key of keys) {
    if (!(key in filled)) filled[key] = 0;
  }
  return filled;
}

/** The whole report: three counts-by-status summaries and the most recently completed bookings. */
async function buildReport() {
  const [bookingCounts, providerCounts, assignmentCounts] = await Promise.all([
    reportRepository.bookingsByStatus(),
    reportRepository.providersByStatus(),
    reportRepository.assignmentsByCompletionStatus(),
  ]);

  // DynamoDB is a second, independently-failing system. The three RDS summaries above are the
  // report's core and must not be lost because a Dynamo query timed out -- this degrades to an
  // empty list with a note on the page, the same choice bookingService.findForRequester makes
  // for one booking's timeline.
  let recentlyCompleted = [];
  let timelineAvailable = true;

  try {
    const events = await timelineRepository.queryCompletedEvents({ limit: HOW_MANY_RECENT });
    recentlyCompleted = events.map((event) => ({
      bookingId: event.bookingId,
      actorName: event.actorName,
      detail: event.detail,
      occurredLabel: formatWallClock(toKualaLumpur(event.occurredAt)),
    }));
  } catch (error) {
    console.error('[reports] completed-events query failed', { error: error.message });
    timelineAvailable = false;
  }

  return {
    bookingCounts: withZeroCounts(BOOKING_STATUSES, bookingCounts),
    providerCounts: withZeroCounts(PROVIDER_STATUSES, providerCounts),
    assignmentCounts: withZeroCounts(COMPLETION_STATUSES, assignmentCounts),
    recentlyCompleted,
    timelineAvailable,
  };
}

module.exports = {
  buildReport,
  withZeroCounts,
  COMPLETION_STATUSES,
  COMPLETION_LABELS,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  PROVIDER_STATUSES,
  PROVIDER_STATUS_LABELS,
};
