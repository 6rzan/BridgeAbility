'use strict';

const { z } = require('zod');

/**
 * Validation for a coordinator assigning a volunteer to a confirmed booking (F7).
 *
 * There is no client-supplied booking id or provider id in here -- both arrive from the URL and
 * are validated by the controller the same way every other id in the application is (a positive
 * integer or nothing). This schema is only the two fields a coordinator actually types.
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

module.exports = { assignmentCreateSchema };
