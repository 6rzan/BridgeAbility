'use strict';

const reportRepository = require('../data/mysql/reportRepository');
const { fetchRecentlyCompleted } = require('./reportsGateway');
const { formatWallClock, toKualaLumpur, STATUSES: BOOKING_STATUSES, STATUS_LABELS: BOOKING_STATUS_LABELS } = require('../validation/bookingSchemas');
const { PROVIDER_STATUSES, PROVIDER_STATUS_LABELS } = require('../validation/adminProviderSchemas');

const COMPLETION_STATUSES = ['pending', 'in_progress', 'completed'];
const COMPLETION_LABELS = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const HOW_MANY_RECENT = 10;

function withZeroCounts(keys, rawCounts) {
  const filled = { ...rawCounts };
  for (const key of keys) {
    if (!(key in filled)) filled[key] = 0;
  }
  return filled;
}

async function buildReport() {
  const [bookingCounts, providerCounts, assignmentCounts] = await Promise.all([
    reportRepository.bookingsByStatus(),
    reportRepository.providersByStatus(),
    reportRepository.assignmentsByCompletionStatus(),
  ]);

  let recentlyCompleted = [];
  let timelineAvailable = true;

  try {
    const events = await fetchRecentlyCompleted(HOW_MANY_RECENT);
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
