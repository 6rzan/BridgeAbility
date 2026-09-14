'use strict';

const config = require('../config');
const timelineRepository = require('../data/dynamo/timelineRepository');

/**
 * Fetches "recently completed bookings" for the admin report (F6), from MS-2's Lambda behind
 * API Gateway when it is configured and reachable, falling back to the monolith's own direct
 * DynamoDB query (timelineRepository.queryCompletedEvents, the pre-Task-2 behaviour) otherwise.
 *
 * Same "must not fail the user's action" shape as notificationPublisher.publishBookingEventSafely
 * and bookingService.appendEventSafely, just inverted: those degrade a write to "logged and
 * skipped"; this degrades a read to "answered locally instead". Either way, config being unset
 * (the Task 1 baseline environment) or the call failing must never turn into a broken admin
 * report page -- see adminReportService.buildReport, which already treats a DynamoDB failure
 * here as non-fatal to the rest of the report.
 */
async function fetchRecentlyCompleted(limit) {
  if (config.reports.recentlyCompletedApiUrl) {
    try {
      // Deliberately not `new URL(path, base)` -- with a leading slash on `path`, that
      // constructor resolves relative to the *origin*, silently dropping API Gateway's stage
      // segment (".../execute-api.../prod") from the base URL. Plain concatenation with the
      // trailing slash stripped is unambiguous.
      const base = config.reports.recentlyCompletedApiUrl.replace(/\/$/, '');
      const url = new URL(`${base}/reports/recently-completed`);
      url.searchParams.set('limit', String(limit));

      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) {
        throw new Error(`MS-2 gateway responded ${response.status}`);
      }

      const body = await response.json();
      return body.recentlyCompleted;
    } catch (error) {
      console.error('[reports] MS-2 gateway failed, falling back to a direct DynamoDB query', {
        error: error.message,
      });
    }
  }

  return timelineRepository.queryCompletedEvents({ limit });
}

module.exports = { fetchRecentlyCompleted };
