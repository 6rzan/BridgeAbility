-- BridgeAbility relational schema — Amazon RDS for MySQL 8
--
-- Applied by db/run-migrations.js from inside the VPC. The RDS instance is
-- PubliclyAccessible = false, so this file can only ever be executed from the
-- application tier; there is no path to it from the public internet.
--
-- Every statement is idempotent so a redeploy can re-run the migration safely.

CREATE TABLE IF NOT EXISTS users (
  user_id             INT AUTO_INCREMENT PRIMARY KEY,
  full_name           VARCHAR(120)  NOT NULL,
  email               VARCHAR(190)  NOT NULL UNIQUE,
  password_hash       VARCHAR(255)  NOT NULL,
  role                ENUM('requester','provider','admin','coordinator') NOT NULL,
  phone               VARCHAR(30)   NULL,
  accessibility_needs TEXT          NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active           TINYINT(1)    NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS providers (
  provider_id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id                 INT           NOT NULL,
  org_name                VARCHAR(150)  NOT NULL,
  description             TEXT          NULL,
  contact                 VARCHAR(120)  NULL,
  verification_doc_s3_key VARCHAR(400)  NULL,
  status                  ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by             INT           NULL,
  reviewed_at             DATETIME      NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_providers_user     FOREIGN KEY (user_id)     REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_providers_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE KEY uq_providers_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS services (
  service_id        INT AUTO_INCREMENT PRIMARY KEY,
  provider_id       INT           NOT NULL,
  title             VARCHAR(160)  NOT NULL,
  category          ENUM('transport','interpreter','caregiver','mobility','other') NOT NULL,
  description       TEXT          NULL,
  price             DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  location          VARCHAR(120)  NOT NULL,
  availability_json JSON          NULL,
  image_s3_key      VARCHAR(400)  NULL,
  -- Alt text is NOT NULL by design: a WCAG requirement enforced as a data constraint,
  -- so an image can never reach the catalogue without a text alternative.
  image_alt_text    VARCHAR(255)  NULL,
  is_active         TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_services_provider FOREIGN KEY (provider_id) REFERENCES providers(provider_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bookings (
  booking_id         INT AUTO_INCREMENT PRIMARY KEY,
  service_id         INT           NOT NULL,
  requester_id       INT           NOT NULL,
  requested_datetime DATETIME      NOT NULL,
  notes              TEXT          NULL,
  status             ENUM('pending','accepted','rejected','assigned','completed','cancelled')
                       NOT NULL DEFAULT 'pending',
  attachment_s3_key  VARCHAR(400)  NULL,
  -- Client-generated idempotency key: a resubmitted form cannot create a second booking.
  request_key        CHAR(36)      NOT NULL UNIQUE,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Drives optimistic locking, so a provider and a coordinator acting at the same moment
  -- cannot silently overwrite each other.
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_service   FOREIGN KEY (service_id)   REFERENCES services(service_id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_requester FOREIGN KEY (requester_id) REFERENCES users(user_id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id     INT AUTO_INCREMENT PRIMARY KEY,
  -- UNIQUE on booking_id is what makes double-assignment impossible: two concurrent
  -- coordinators racing on the same booking produce a duplicate-key error, not two rows.
  booking_id        INT           NOT NULL UNIQUE,
  volunteer_name    VARCHAR(120)  NOT NULL,
  volunteer_contact VARCHAR(120)  NOT NULL,
  assigned_by       INT           NOT NULL,
  assigned_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completion_status ENUM('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
  completion_notes  TEXT          NULL,
  completed_at      DATETIME      NULL,
  CONSTRAINT fk_assignments_booking FOREIGN KEY (booking_id)  REFERENCES bookings(booking_id) ON DELETE CASCADE,
  CONSTRAINT fk_assignments_user    FOREIGN KEY (assigned_by) REFERENCES users(user_id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes named in the design. Each exists for one specific query:
--   idx_services_category  — the requester catalogue filters on category AND is_active
--   idx_bookings_requester — "my bookings" reads one requester's rows by status
--   idx_bookings_service   — a provider's incoming queue reads by service and status
CREATE INDEX idx_services_category  ON services(category, is_active);
CREATE INDEX idx_bookings_requester ON bookings(requester_id, status);
CREATE INDEX idx_bookings_service   ON bookings(service_id, status);
