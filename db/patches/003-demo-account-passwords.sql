-- 003-demo-account-passwords.sql
--
-- Sets the password for the seeded demonstration accounts to the values published in
-- README.md, so an assessor can sign in as each role.
--
-- WHY THIS PATCH EXISTS. seed.sql only runs against an empty database, so once an environment
-- has been seeded there is no way to correct the seeded credentials through it. The original
-- demo passwords were never written down and a bcrypt hash cannot be reversed, so they were
-- unrecoverable and had to be reset rather than retrieved.
--
-- SCOPE. The WHERE clause is restricted to the @bridgeability.demo addresses created by the
-- seed. An account registered through the live site is never touched, so re-running this
-- cannot clobber a real user's password.
--
-- Idempotent: an UPDATE to a fixed value converges, so every redeploy is a no-op.

-- requester: published in README.md
UPDATE users
   SET password_hash = '$2a$12$aLjTpR3Vm7hnvxu5qnVem.JNn1kJ7TtRh.XQaVHXPQKEh4uOCLzZ6'
 WHERE role = 'requester'
   AND email LIKE '%@bridgeability.demo';

-- provider: published in README.md
UPDATE users
   SET password_hash = '$2a$12$PN5Jn1xRHYYDTDQxoT7R.e1cp4G8Kadv8Y/CAHCToLUssY4NtbHs2'
 WHERE role = 'provider'
   AND email LIKE '%@bridgeability.demo';

-- admin: published in README.md
UPDATE users
   SET password_hash = '$2a$12$2mnTqgDmEBPul8JewYOy6u9gUJWLPvofgFUOyZQdNjWwHMAbSQfla'
 WHERE role = 'admin'
   AND email LIKE '%@bridgeability.demo';

-- coordinator: published in README.md
UPDATE users
   SET password_hash = '$2a$12$cc0T/jHKdhMbJCStREyD0euBhuBAIyav/O1RqxEVXwLTYn8h229Y6'
 WHERE role = 'coordinator'
   AND email LIKE '%@bridgeability.demo';
