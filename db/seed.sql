-- BridgeAbility seed data
--
-- Applied by db/run-migrations.js only when the users table is empty.
--
-- Deliberately covers every state the application can be in, so all four members have live
-- material to demonstrate without creating records on camera:
--   * providers in all three review states (approved / pending / rejected)
--   * services across all five categories, active and inactive
--   * bookings sitting in all six statuses
--   * assignments in pending, in_progress and completed
--
-- Password hashes are bcrypt, cost factor 12. The corresponding plaintext passwords are
-- published in README.md for the assessor, so these hashes are not secrets.

-- ---------------------------------------------------------------- users
INSERT INTO users (user_id, full_name, email, password_hash, role, phone, accessibility_needs) VALUES
  (1, 'Aisha Rahman',       'requester@bridgeability.demo',   '$2a$12$doos7Js6GDjkpagXxN7Aluh7RlEVf6I4bQ5eBeKO32Kd.n72lfdou', 'requester',   '+60 12-555 0101', 'Wheelchair user; needs step-free access and a ramp-equipped vehicle.'),
  (2, 'Kumar Selvam',       'kumar@bridgeability.demo',       '$2a$12$doos7Js6GDjkpagXxN7Aluh7RlEVf6I4bQ5eBeKO32Kd.n72lfdou', 'requester',   '+60 12-555 0102', 'Deaf; communicates in Malaysian Sign Language.'),
  (3, 'Mei Ling Tan',       'meiling@bridgeability.demo',     '$2a$12$doos7Js6GDjkpagXxN7Aluh7RlEVf6I4bQ5eBeKO32Kd.n72lfdou', 'requester',   '+60 12-555 0103', 'Low vision; prefers large print and verbal descriptions.'),

  (4, 'Zulhakim Ismail',    'provider@bridgeability.demo',    '$2a$12$2eye7v60WX6Xs3527nwlX.t7loTLrTcKDGpmiSr0z.SMJFfLv3BcC', 'provider',    '+60 13-555 0201', NULL),
  (5, 'Grace Anak Joseph',  'grace@bridgeability.demo',       '$2a$12$2eye7v60WX6Xs3527nwlX.t7loTLrTcKDGpmiSr0z.SMJFfLv3BcC', 'provider',    '+60 13-555 0202', NULL),
  (6, 'Ravi Chandran',      'ravi@bridgeability.demo',        '$2a$12$2eye7v60WX6Xs3527nwlX.t7loTLrTcKDGpmiSr0z.SMJFfLv3BcC', 'provider',    '+60 13-555 0203', NULL),
  (7, 'Nadia Osman',        'nadia@bridgeability.demo',       '$2a$12$2eye7v60WX6Xs3527nwlX.t7loTLrTcKDGpmiSr0z.SMJFfLv3BcC', 'provider',    '+60 13-555 0204', NULL),
  (8, 'Faizal Aziz',        'faizal@bridgeability.demo',      '$2a$12$2eye7v60WX6Xs3527nwlX.t7loTLrTcKDGpmiSr0z.SMJFfLv3BcC', 'provider',    '+60 13-555 0205', NULL),

  (9, 'Lama Aldhahyani',    'admin@bridgeability.demo',       '$2a$12$u.CIgoMkXvw.yU8J2FpqdOhGz5YAAxqwSjEJIOwjWWTnvCELXg0mS', 'admin',       '+60 14-555 0301', NULL),
  (10,'Noor Khalil',        'coordinator@bridgeability.demo', '$2a$12$7wvDp8yj5mWkVe2FWxoa2enzN.5jd7THztNRPNkAddWpKY2TbrIi2', 'coordinator', '+60 15-555 0401', NULL);

-- ------------------------------------------------------------ providers
-- Three approved, one awaiting review, one rejected. The pending row is what the admin
-- queue (F5) operates on; the rejected row proves rejected listings stay invisible.
INSERT INTO providers (provider_id, user_id, org_name, description, contact, verification_doc_s3_key, status, reviewed_by, reviewed_at) VALUES
  (1, 4, 'SilentBridge Interpreting',    'Certified Malaysian Sign Language interpreters for medical, legal and education settings.', 'hello@silentbridge.my', 'verification/provider-1-ssm.pdf', 'approved', 9, '2026-07-02 09:15:00'),
  (2, 5, 'AccessRide Klang Valley',      'Wheelchair-accessible vehicles with trained drivers across the Klang Valley.',              'book@accessride.my',   'verification/provider-2-ssm.pdf', 'approved', 9, '2026-07-04 11:40:00'),
  (3, 6, 'CareCompanion Home Support',   'Trained personal caregivers for daily living support and respite care.',                    'care@carecompanion.my','verification/provider-3-ssm.pdf', 'approved', 9, '2026-07-09 14:05:00'),
  (4, 7, 'MobilityFirst Equipment',      'Mobility aid rental, delivery and on-site fitting.',                                        'rent@mobilityfirst.my','verification/provider-4-ssm.pdf', 'pending',  NULL, NULL),
  (5, 8, 'QuickHelp Services',           'General assistance services. Submitted incomplete registration documents.',                 'info@quickhelp.my',    'verification/provider-5-ssm.pdf', 'rejected', 9, '2026-07-15 16:20:00');

-- ------------------------------------------------------------- services
-- Eleven listings spanning all five categories. Service 10 is inactive (the provider
-- deactivated it); service 11 belongs to the rejected provider and must never appear in
-- the public catalogue -- tests/integration asserts exactly that.
INSERT INTO services (service_id, provider_id, title, category, description, price, location, availability_json, image_s3_key, image_alt_text, is_active) VALUES
  (1,  1, 'Malaysian Sign Language interpreter — medical appointments', 'interpreter', 'Certified MSL interpreter for hospital and clinic appointments. Two hour minimum.',           180.00, 'Kuala Lumpur',  '{"days":["Mon","Tue","Wed","Thu","Fri"],"hours":"08:00-18:00"}', 'services/service-1.jpg',  'Interpreter signing beside a patient at a clinic reception desk.', 1),
  (2,  1, 'Sign language interpreter — legal and court settings',       'interpreter', 'Court-experienced interpreter for legal consultations and hearings.',                        260.00, 'Kuala Lumpur',  '{"days":["Mon","Tue","Wed","Thu","Fri"],"hours":"09:00-17:00"}', 'services/service-2.jpg',  'Interpreter seated beside a client in a meeting room.',            1),
  (3,  1, 'Live captioning for events and lectures',                    'other',       'Real-time captioning displayed on screen for conferences, lectures and town halls.',         320.00, 'Petaling Jaya', '{"days":["Mon","Wed","Fri","Sat"],"hours":"08:00-22:00"}',        'services/service-3.jpg',  'Screen showing live captions at a conference session.',            1),
  (4,  2, 'Wheelchair-accessible airport transfer',                     'transport',   'Ramp-equipped van with securement straps. KLIA and Subang, door to door.',                   150.00, 'Kuala Lumpur',  '{"days":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],"hours":"00:00-23:59"}', 'services/service-4.jpg', 'Van with a deployed rear access ramp at a kerbside.',   1),
  (5,  2, 'Accessible transport — medical appointments',                'transport',   'Return trips to hospitals and clinics with a trained driver assistant.',                      95.00, 'Shah Alam',     '{"days":["Mon","Tue","Wed","Thu","Fri"],"hours":"07:00-19:00"}', 'services/service-5.jpg',  'Driver securing a wheelchair inside an accessible vehicle.',       1),
  (6,  2, 'Group accessible transport — day trips',                     'transport',   'Up to four wheelchair spaces plus seated companions for outings.',                           420.00, 'Klang',         '{"days":["Sat","Sun"],"hours":"07:00-20:00"}',                   'services/service-6.jpg',  'Minibus with a lowered floor and wide side entrance.',             1),
  (7,  3, 'Personal caregiver — daily living support',                  'caregiver',   'Assistance with washing, dressing, meals and medication reminders. Four hour blocks.',       140.00, 'Petaling Jaya', '{"days":["Mon","Tue","Wed","Thu","Fri","Sat"],"hours":"06:00-22:00"}', 'services/service-7.jpg', 'Caregiver helping a person prepare a meal in a kitchen.',    1),
  (8,  3, 'Overnight respite care',                                     'caregiver',   'Overnight cover so a family carer can rest. Twelve hour shift.',                             300.00, 'Subang Jaya',   '{"days":["Fri","Sat","Sun"],"hours":"19:00-07:00"}',             'services/service-8.jpg',  'Caregiver reading in a softly lit living room at night.',          1),
  (9,  3, 'Wheelchair and mobility aid delivery with fitting',          'mobility',    'Delivery, assembly and on-site adjustment of wheelchairs and walking frames.',               110.00, 'Kuala Lumpur',  '{"days":["Mon","Wed","Fri"],"hours":"09:00-17:00"}',             'services/service-9.jpg',  'Technician adjusting the footrest of a manual wheelchair.',        1),
  (10, 1, 'Sign language interpreter — weekend community events',       'interpreter', 'Withdrawn for the current season while the interpreter roster is rebuilt.',                  200.00, 'Kuala Lumpur',  '{"days":["Sat","Sun"],"hours":"09:00-18:00"}',                   'services/service-10.jpg', 'Interpreter signing on a small stage at a community hall.',        0),
  (11, 5, 'General mobility assistance',                                'mobility',    'Listing from a rejected provider. Must never appear in the public catalogue.',                80.00, 'Kuala Lumpur',  '{"days":["Mon"],"hours":"09:00-17:00"}',                          NULL,                     NULL,                                                               1);

-- ------------------------------------------------------------- bookings
-- One booking in each of the six statuses, plus extras so each queue has depth.
INSERT INTO bookings (booking_id, service_id, requester_id, requested_datetime, notes, status, request_key, created_at, updated_at) VALUES
  (1, 1, 1, '2026-08-22 10:00:00', 'Cardiology follow-up at Hospital Kuala Lumpur. Please arrive 15 minutes early.', 'pending',   'b1a7c4e2-1111-4a01-9f10-0000000000a1', '2026-08-14 09:12:00', '2026-08-14 09:12:00'),
  (2, 4, 1, '2026-08-25 06:30:00', 'KLIA Terminal 1 departure. Manual wheelchair, folds flat.',                      'accepted',  'b1a7c4e2-2222-4a02-9f10-0000000000a2', '2026-08-12 15:40:00', '2026-08-13 08:05:00'),
  (3, 7, 3, '2026-08-19 08:00:00', 'Morning support, four hours. Large print notes appreciated.',                    'assigned',  'b1a7c4e2-3333-4a03-9f10-0000000000a3', '2026-08-10 11:20:00', '2026-08-13 10:15:00'),
  (4, 5, 2, '2026-08-05 09:00:00', 'Physiotherapy appointment, return trip.',                                        'completed', 'b1a7c4e2-4444-4a04-9f10-0000000000a4', '2026-08-01 13:05:00', '2026-08-05 12:40:00'),
  (5, 2, 2, '2026-08-18 14:00:00', 'Legal consultation. Interpreter must be court-experienced.',                     'rejected',  'b1a7c4e2-5555-4a05-9f10-0000000000a5', '2026-08-11 16:55:00', '2026-08-12 09:30:00'),
  (6, 9, 3, '2026-08-21 11:00:00', 'Cancelled — equipment arrived from another source.',                             'cancelled', 'b1a7c4e2-6666-4a06-9f10-0000000000a6', '2026-08-09 10:00:00', '2026-08-10 17:45:00'),
  (7, 8, 1, '2026-08-23 19:00:00', 'Overnight respite so my mother can travel.',                                     'pending',   'b1a7c4e2-7777-4a07-9f10-0000000000a7', '2026-08-15 08:30:00', '2026-08-15 08:30:00'),
  (8, 6, 2, '2026-08-30 08:00:00', 'Day trip to Putrajaya, two wheelchair spaces needed.',                           'accepted',  'b1a7c4e2-8888-4a08-9f10-0000000000a8', '2026-08-13 12:00:00', '2026-08-14 14:20:00'),
  (9, 3, 3, '2026-08-28 09:00:00', 'University lecture series, three sessions.',                                     'pending',   'b1a7c4e2-9999-4a09-9f10-0000000000a9', '2026-08-15 17:10:00', '2026-08-15 17:10:00'),
  (10,7, 2, '2026-08-08 07:00:00', 'Weekly support visit.',                                                          'completed', 'b1a7c4e2-aaaa-4a10-9f10-0000000000b0', '2026-08-02 09:00:00', '2026-08-08 12:00:00');

-- ---------------------------------------------------------- assignments
-- Only bookings that reached 'assigned' or 'completed' carry an assignment row.
INSERT INTO assignments (assignment_id, booking_id, volunteer_name, volunteer_contact, assigned_by, assigned_at, completion_status, completion_notes, completed_at) VALUES
  (1, 3,  'Siti Nurhaliza Abdullah', '+60 16-555 0501', 10, '2026-08-13 10:15:00', 'in_progress', 'Volunteer briefed on large-print requirement.', NULL),
  (2, 4,  'Daniel Wong',             '+60 16-555 0502', 10, '2026-08-03 14:30:00', 'completed',   'Return trip completed without issues. Requester confirmed arrival home.', '2026-08-05 12:40:00'),
  (3, 10, 'Priya Ramasamy',          '+60 16-555 0503', 10, '2026-08-04 10:00:00', 'completed',   'Weekly visit completed. Next visit to be scheduled by the requester.',    '2026-08-08 12:00:00');
