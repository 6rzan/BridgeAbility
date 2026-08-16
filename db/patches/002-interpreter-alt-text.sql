-- Correct the alt text on the interpreter listings.
--
-- WHY. 001 set 'two hands mid-sign beside a speech bubble', which described a drawing that,
-- rendered at card size, collapsed into a single raised finger -- a rude gesture on a page
-- about accessibility services, and not two hands either. The illustration was redrawn as a
-- person signing with both hands raised (db/seed-media.js), so the description has to follow
-- it. Alt text that does not match its image tells a screen reader user something untrue,
-- which is exactly the failure this platform exists to avoid.
--
-- 001 is left as it was. Patches are a record of what was applied, not a document to rewrite;
-- an environment seeded before either patch runs both in order and lands in the same state.
--
-- The WHERE clause keys on the placeholder object, so a real provider image uploaded through
-- F3 -- which carries its own author-written alt text -- is never touched.

UPDATE services
   SET image_alt_text = 'Illustration: a person signing with both hands raised, beside a speech bubble.'
 WHERE image_s3_key = 'services/placeholder-interpreter.svg'
   AND image_alt_text = 'Illustration: two hands mid-sign beside a speech bubble.';
