'use strict';

const bcrypt = require('bcryptjs');

const { withTransaction } = require('../data/mysql/pool');
const userRepository = require('../data/mysql/userRepository');

/**
 * Authentication rules: hashing, credential checking and account creation.
 *
 * Kept out of the controller so the rules can be unit tested and so a second caller -- the
 * seeding script, a future API -- cannot accidentally implement them differently.
 */

// bcrypt work factor. 12 is the cost the seeded demo accounts were hashed at, and it is the
// current common recommendation: expensive enough that offline cracking of a stolen hash is
// slow, cheap enough that a sign-in stays well under a second on a t3.micro.
const BCRYPT_COST = 12;

/**
 * A real bcrypt hash of a value nobody can supply. When an email does not exist we verify a
 * password against this instead of returning early, so a request for a missing account takes
 * the same time as one for a real account. Without it, response timing tells an attacker
 * which addresses are registered.
 */
const DUMMY_HASH = bcrypt.hashSync('bridgeability-timing-equaliser', BCRYPT_COST);

/** Everything the session needs, and nothing more. No hash ever enters the session. */
function toSessionUser(row) {
  return {
    id: row.user_id,
    name: row.full_name,
    email: row.email,
    role: row.role,
  };
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

/**
 * Verify credentials.
 *
 * Returns the session user on success and null on any failure. The caller must not tell them
 * apart in the message it shows: "wrong password" versus "no such account" is an account
 * enumeration oracle, letting someone confirm which addresses are registered here -- which
 * for a disability services platform is itself sensitive information.
 */
async function verifyCredentials(email, plainPassword) {
  const record = await userRepository.findAuthRecordByEmail(email);

  const passwordMatches = await bcrypt.compare(
    plainPassword,
    record ? record.password_hash : DUMMY_HASH
  );

  if (!record || !passwordMatches || !record.is_active) {
    return null;
  }

  return toSessionUser(record);
}

/** Raised for a duplicate email so the controller can attach it to the right form field. */
class EmailInUseError extends Error {
  constructor() {
    super('An account with that email address already exists.');
    this.name = 'EmailInUseError';
    this.field = 'email';
  }
}

/**
 * Create an account. A provider also gets their (pending) provider record, in the same
 * transaction as the user row.
 *
 * `role` reaches here already narrowed to 'requester' or 'provider' by the zod schema, so
 * there is no path from a request body to an admin or coordinator account.
 */
async function register(input) {
  const passwordHash = await hashPassword(input.password);

  try {
    return await withTransaction(async (connection) => {
      const userId = await userRepository.insertUser(connection, {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: input.role,
        phone: input.phone,
        accessibilityNeeds: input.accessibilityNeeds,
      });

      if (input.role === 'provider') {
        await userRepository.insertProvider(connection, {
          userId,
          orgName: input.orgName,
          contact: input.phone,
        });
      }

      return toSessionUser({
        user_id: userId,
        full_name: input.fullName,
        email: input.email,
        role: input.role,
      });
    });
  } catch (error) {
    // The UNIQUE index on users.email is the authority on duplicates, not a prior SELECT.
    // Checking first and inserting second leaves a window where two concurrent registrations
    // both pass the check; letting the constraint decide closes it.
    if (error.code === 'ER_DUP_ENTRY') {
      throw new EmailInUseError();
    }
    throw error;
  }
}

module.exports = {
  register,
  verifyCredentials,
  hashPassword,
  toSessionUser,
  EmailInUseError,
  BCRYPT_COST,
};
