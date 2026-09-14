'use strict';

const { z } = require('zod');

/**
 * Validation for a coordinator assigning a volunteer to a confirmed booking (F7) and logging
 * how it finished (F8).
 *
 * There is no client-supplied booking id or provider id in here -- both arrive from the URL and
 * are validated by the controller the same way every other id in the application is (a positive
 * integer or nothing). These schemas are only the fields a coordinator actually types.
 */

const assignmentCreateSchema = z.object({
  volunteerName: z
    .string()
    .trim()
    .min(2, 'Enter the volunteer’s name.')
    .max(120, 'Use 120 characters or fewer.'),

  // A phone number or an email -- whatever the coordinator has on hand to reach the volunteer.
  // Free text rather than a phone-shaped regex, the same choice providers.contact already made.
  volunteerContact: z
    .string()
    .trim()
    .min(5, 'Enter a way to reach the volunteer.')
    .max(120, 'Use 120 characters or fewer.'),
});

/** How the three completion statuses are shown, in words. Matches assignments.completion_status. */
const COMPLETION_LABELS = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

const COMPLETION_STATUSES = Object.keys(COMPLETION_LABELS);

function blankToNull(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * `completed` is enforced as terminal by `assignmentRepository.updateCompletion`'s own guard,
 * not here -- this schema only checks that the three fields are individually well-formed, the
 * same separation of concerns as `bookingListSchema` (shape) versus `cancelPending` (state
 * transition rule).
 */
const completionUpdateSchema = z.object({
  completionStatus: z.enum(COMPLETION_STATUSES, {
    errorMap: () => ({ message: 'Choose a completion status.' }),
  }),

  completionNotes: z.preprocess(
    blankToNull,
    z.string()
      .max(1000, 'Keep the notes under 1000 characters.')
      .nullable()
  ),
});

module.exports = {
  assignmentCreateSchema,
  completionUpdateSchema,
  COMPLETION_STATUSES,
  COMPLETION_LABELS,
};
