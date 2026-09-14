'use strict';

const { z } = require('zod');




const assignmentCreateSchema = z.object({
  volunteerName: z
    .string()
    .trim()
    .min(2, 'Enter the volunteer’s name.')
    .max(120, 'Use 120 characters or fewer.'),


  volunteerContact: z
    .string()
    .trim()
    .min(5, 'Enter a way to reach the volunteer.')
    .max(120, 'Use 120 characters or fewer.'),
});


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
