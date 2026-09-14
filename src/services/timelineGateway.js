'use strict';

const config = require('../config');
const timelineRepository = require('../data/dynamo/timelineRepository');

/**
 * Fetches one booking's history for the three services that show it (F2's own booking detail,
 * F4's incoming-request detail, F7/F8's coordinator detail), from MS-3's Lambda behind API
 * Gateway (Task 2, docs/task2-plan.md) when configured and reachable, falling back to the
 * monolith's own direct DynamoDB query (timelineRepository.listEvents, the pre-Task-2 behaviour)
 * otherwise.
 *
 * Deliberately called from server-side code that has already checked the caller owns or is
 * entitled to see this booking, never from the browser directly -- see services/timeline/index.js
 * for why. Same "must not fail the user's action" shape as reportsGateway.fetchRecentlyCompleted
 * and the other *Safely helpers in this codebase: config being unset (the Task 1 baseline
 * environment) or the call failing must never turn the booking detail page into an error page,
 * only into one with an empty or unavailable timeline -- the callers already wrap this in their
 * own try/catch for exactly that reason.
 */
async function fetchTimeline(bookingId) {
  if (config.timeline.apiUrl) {
    try {
      // Deliberately not `new URL(path, base)` -- see reportsGateway.js for why a leading slash
      // on the relative part silently drops API Gateway's stage segment from the base URL.
      const base = config.timeline.apiUrl.replace(/\/$/, '');
      const response = await fetch(`${base}/timeline/${bookingId}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        throw new Error(`MS-3 gateway responded ${response.status}`);
      }

      const body = await response.json();
      return body.timeline;
    } catch (error) {
      console.error('[timeline] MS-3 gateway failed, falling back to a direct DynamoDB query', {
        bookingId,
        error: error.message,
      });
    }
  }

  return timelineRepository.listEvents(bookingId);
}

module.exports = { fetchTimeline };
