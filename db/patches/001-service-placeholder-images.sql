-- Point the seeded listings at the placeholder illustrations that db/seed-media.js uploads,
-- and replace the alt text with a description of what those illustrations actually show.
--
-- WHY A PATCH AND NOT AN EDIT TO seed.sql. Seeding only runs against an empty database, and
-- the deployed environment already holds the seeded rows. Patches run on every deploy, so
-- this reaches an environment that has already been seeded.
--
-- WHY THE WHERE CLAUSE MATTERS. Each statement only touches rows still carrying the original
-- `services/service-N.jpg` key, which names an object that was never uploaded. Once a provider
-- uploads a real image through F3, the key no longer matches and this patch leaves it alone.
-- Re-running the patch after that changes nothing, which is what makes it safe on every deploy.
--
-- The alt text describes the illustration rather than claiming to describe a photograph. Alt
-- text that misdescribes an image is worse than no image at all: it tells a screen reader user
-- something about the listing that is not true.

UPDATE services
   SET image_s3_key  = 'services/placeholder-transport.svg',
       image_alt_text = 'Illustration: a van seen from the side with its rear access ramp lowered to the kerb.'
 WHERE category = 'transport'
   AND image_s3_key LIKE 'services/service-%';

UPDATE services
   SET image_s3_key  = 'services/placeholder-interpreter.svg',
       image_alt_text = 'Illustration: two hands mid-sign beside a speech bubble.'
 WHERE category = 'interpreter'
   AND image_s3_key LIKE 'services/service-%';

UPDATE services
   SET image_s3_key  = 'services/placeholder-caregiver.svg',
       image_alt_text = 'Illustration: one person steadying another by the arm.'
 WHERE category = 'caregiver'
   AND image_s3_key LIKE 'services/service-%';

UPDATE services
   SET image_s3_key  = 'services/placeholder-mobility.svg',
       image_alt_text = 'Illustration: a manual wheelchair seen from the side.'
 WHERE category = 'mobility'
   AND image_s3_key LIKE 'services/service-%';

UPDATE services
   SET image_s3_key  = 'services/placeholder-other.svg',
       image_alt_text = 'Illustration: a screen displaying lines of live captions.'
 WHERE category = 'other'
   AND image_s3_key LIKE 'services/service-%';
