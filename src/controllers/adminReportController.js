'use strict';

const adminReportService = require('../services/adminReportService');





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
