'use strict';

const { z } = require('zod');

const password = z
  .string()
  .min(12, 'Use at least 12 characters. A short phrase you can remember works well.')
  .max(128, 'Use 128 characters or fewer.');

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address.')
  .max(190, 'Use 190 characters or fewer.')
  .email('Enter an email address in the format name@example.com.');

const optionalText = (max) => z
  .string()
  .trim()
  .max(max, `Use ${max} characters or fewer.`)
  .optional()
  .transform((value) => (value ? value : null));

const loginSchema = z.object({
  email,

  password: z.string().min(1, 'Enter your password.'),
});

const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your name.')
      .max(120, 'Use 120 characters or fewer.'),
    email,
    password,
    confirmPassword: z.string(),
    role: z.enum(['requester', 'provider'], {
      errorMap: () => ({ message: 'Choose whether you are booking services or offering them.' }),
    }),
    phone: optionalText(30),
    accessibilityNeeds: optionalText(2000),
    orgName: optionalText(150),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        path: ['confirmPassword'],
        code: z.ZodIssueCode.custom,
        message: 'Both password fields must match.',
      });
    }

    if (value.role === 'provider' && !value.orgName) {
      ctx.addIssue({
        path: ['orgName'],
        code: z.ZodIssueCode.custom,
        message: 'Enter the name of your organisation.',
      });
    }
  });

function fieldErrors(error) {
  const errors = {};
  for (const issue of error.issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'form';
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

module.exports = { loginSchema, registerSchema, fieldErrors };
