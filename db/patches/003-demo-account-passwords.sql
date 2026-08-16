-- 003-demo-account-passwords.sql
--
-- Sets the password for each seeded demonstration account to the TP number of the group member
-- who owns that role, so an assessor can sign in as each role and the credential maps to the
-- workload matrix. The plaintext is published in README.md.
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

-- requester (Taha Fahd Ahmed Mohammed): password published in README.md
UPDATE users
   SET password_hash = '$2a$12$ZInFzsTw9X0DRgqyzVu2Keu8eQoli1xYRienSBumgl/DzQYotO76y'
 WHERE role = 'requester'
   AND email LIKE '%@bridgeability.demo';

-- provider (Abubaker Elsiddig Tageldeen): password published in README.md
UPDATE users
   SET password_hash = '$2a$12$0xUpig2a69Y/D0Z7kzSD/.ONfDEBXqZmvEvcXXFr4N/sn3Arwl8zy'
 WHERE role = 'provider'
   AND email LIKE '%@bridgeability.demo';

-- admin (Aldhahyani Lama M. A.): password published in README.md
UPDATE users
   SET password_hash = '$2a$12$j4epWOcHj8X2vh/753Tr2.I/4o5QTZLkwrbqRAZM91i9Wl8TaO/R6'
 WHERE role = 'admin'
   AND email LIKE '%@bridgeability.demo';

-- coordinator (Noor Khalil Abdullah Khaled): password published in README.md
UPDATE users
   SET password_hash = '$2a$12$Fi4uFh/vaYSrEP7b.xE//OwPsOwZMs9LlJcTs54TI5bHCaX2ZrPfC'
 WHERE role = 'coordinator'
   AND email LIKE '%@bridgeability.demo';
