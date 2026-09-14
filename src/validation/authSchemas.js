'use strict';

const { z } = require('zod');

/**
 * Request validation for the authentication routes.
 *
 * Validation happens at the system boundary: nothing downstream re-checks shapes or lengths,
 * so a controller can trust what it is handed. Client-side validation in
 * public/js/form-validate.js exists to give faster feedback and is never trusted -- it can be
 * bypassed with a `curl` call, and these schemas are what actually protects the database.
 */

// The password floor is length, not composition. NIST SP 800-63B section 5.1.1.2 recommends a
// minimum length with no mandatory character-class rules, because composition rules push
// people toward predictable substitutions. The 128 ceiling exists so an enormous string
// cannot be used to make bcrypt burn CPU.
// https://pages.nist.gov/800-63-3/sp800-63b.html (accessed 16 August 2026)
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
  // No length rule on sign-in. The stored password was validated when it was set, and telling
  // someone their attempt is "too short" is feedback about a secret we should not give.
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * Registration is open to requesters and providers only. `admin` and `coordinator` are
 * deliberately absent from this enum: those accounts are created by seeding, so a crafted
 * POST cannot mint itself an administrator. This is the whole of the privilege-escalation
 * defence at registration, and it is one line.
 */
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

    // A provider row cannot exist without an organisation name, so the requirement is
    // conditional on the role rather than applied to everyone.
    if (value.role === 'provider' && !value.orgName) {
      ctx.addIssue({
        path: ['orgName'],
        code: z.ZodIssueCode.custom,
        message: 'Enter the name of your organisation.',
      });
    }
  });

/**
 * Flatten a ZodError into `{ field: 'message' }`, which is the shape the views render into
 * each field's `aria-describedby` target and into the error summary at the top of the form.
 */
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
