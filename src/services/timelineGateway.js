'use strict';

const config = require('../config');
const timelineRepository = require('../data/dynamo/timelineRepository');

async function fetchTimeline(bookingId) {
  if (config.timeline.apiUrl) {
    try {

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
