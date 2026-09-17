'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loginSchema, registerSchema, fieldErrors } = require('../../src/validation/authSchemas');

function expectFailure(schema, input, field) {
  const result = schema.safeParse(input);
  assert.equal(result.success, false, `expected ${field} to be rejected`);
  assert.ok(fieldErrors(result.error)[field], `expected an error on "${field}"`);
  return fieldErrors(result.error);
}

const validRegistration = {
  fullName: 'Aisha Rahman',
  email: 'aisha@example.com',
  password: 'correct horse battery',
  confirmPassword: 'correct horse battery',
  role: 'requester',
};

test('registration accepts a requester with the minimum fields', () => {
  const result = registerSchema.safeParse(validRegistration);
  assert.equal(result.success, true);
  assert.equal(result.data.role, 'requester');

  assert.equal(result.data.phone, null);
});

test('registration refuses to create an admin or coordinator account', () => {
  for (const role of ['admin', 'coordinator']) {
    expectFailure(registerSchema, { ...validRegistration, role }, 'role');
  }
});

test('registration requires an organisation name from a provider only', () => {
  expectFailure(
    registerSchema,
    { ...validRegistration, role: 'provider' },
    'orgName'
  );

  const withOrg = registerSchema.safeParse({
    ...validRegistration,
    role: 'provider',
    orgName: 'Klang Valley Access Transport',
  });
  assert.equal(withOrg.success, true);
});

test('registration rejects a password under 12 characters', () => {
  expectFailure(
    registerSchema,
    { ...validRegistration, password: 'Short#1', confirmPassword: 'Short#1' },
    'password'
  );
});

test('registration rejects mismatched password confirmation', () => {
  const errors = expectFailure(
    registerSchema,
    { ...validRegistration, confirmPassword: 'correct horse batteries' },
    'confirmPassword'
  );
  assert.match(errors.confirmPassword, /match/i);
});

test('registration rejects a malformed email address', () => {
  expectFailure(registerSchema, { ...validRegistration, email: 'aisha at example' }, 'email');
});

test('email is trimmed and lowercased before it reaches the database', () => {
  const result = registerSchema.safeParse({
    ...validRegistration,
    email: '  Aisha@Example.COM  ',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, 'aisha@example.com');
});

test('sign-in applies no length rule to the password', () => {

  const result = loginSchema.safeParse({ email: 'a@b.co', password: 'x' });
  assert.equal(result.success, true);
});

test('sign-in still requires both fields', () => {
  expectFailure(loginSchema, { email: 'a@b.co', password: '' }, 'password');
  expectFailure(loginSchema, { email: '', password: 'whatever' }, 'email');
});

test('fieldErrors keeps the first message per field and keys it by field name', () => {
  const result = registerSchema.safeParse({ ...validRegistration, email: 'nope', fullName: 'A' });
  const errors = fieldErrors(result.error);

  assert.deepEqual(Object.keys(errors).sort(), ['email', 'fullName']);
  assert.equal(typeof errors.email, 'string');
});
