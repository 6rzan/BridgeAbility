'use strict';

const adminReportService = require('../services/adminReportService');

/**
 * F6 -- an administrator monitors system-wide activity through reports.
 *
 * One route, read-only: no form, no CSRF token needed, no per-row ownership -- the same
 * "role guard is the whole access model" reasoning as F5's adminProviderController.
 */

/** GET /admin/reports -- counts by status across bookings, providers and assignments. */
async function getReport(req, res, next) {
  try {
    const {
      bookingCounts,
      providerCounts,
      assignmentCounts,
      recentlyCompleted,
      timelineAvailable,
    } = await adminReportService.buildReport();

    return res.render('admin/reports/index', {
      title: 'Activity reports',
      bookingCounts,
      providerCounts,
      assignmentCounts,
      recentlyCompleted,
      timelineAvailable,
      bookingStatuses: adminReportService.BOOKING_STATUSES,
      bookingStatusLabels: adminReportService.BOOKING_STATUS_LABELS,
      providerStatuses: adminReportService.PROVIDER_STATUSES,
      providerStatusLabels: adminReportService.PROVIDER_STATUS_LABELS,
      completionStatuses: adminReportService.COMPLETION_STATUSES,
      completionLabels: adminReportService.COMPLETION_LABELS,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getReport };
