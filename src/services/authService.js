'use strict';

const bcrypt = require('bcryptjs');

const { withTransaction } = require('../data/mysql/pool');
const userRepository = require('../data/mysql/userRepository');





const BCRYPT_COST = 12;



const DUMMY_HASH = bcrypt.hashSync('bridgeability-timing-equaliser', BCRYPT_COST);


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


class EmailInUseError extends Error {
  constructor() {
    super('An account with that email address already exists.');
    this.name = 'EmailInUseError';
    this.field = 'email';
  }
}



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
