'use strict';

const config = require('../config');
const timelineRepository = require('../data/dynamo/timelineRepository');

async function fetchRecentlyCompleted(limit) {
  if (config.reports.recentlyCompletedApiUrl) {
    try {

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
