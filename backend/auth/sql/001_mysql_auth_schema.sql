-- MySQL 8.0+ / InnoDB. IDs remain 24-character hexadecimal strings to preserve JWTs,
-- URL params and cursor formats. Payload is MySQL's native JSON column (not MongoDB).
-- Generated columns maintain database-level unique and query-plan indexes.
CREATE TABLE IF NOT EXISTS users (
  id CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.email'))) STORED,
  role VARCHAR(32) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.role'))) STORED,
  is_verified VARCHAR(5) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.isVerified'))) STORED,
  created_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.createdAt'))) STORED,
  email_verification_hash CHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.emailVerificationHash'))) STORED,
  UNIQUE KEY uniq_users_email (email),
  KEY idx_users_role_created_id (role,created_at DESC,id DESC),
  KEY idx_users_role_verification_created_id (role,is_verified,created_at DESC,id DESC),
  KEY idx_users_email_verification_hash (email_verification_hash),
  CONSTRAINT chk_users_email CHECK (email IS NOT NULL AND email <> ''),
  CONSTRAINT chk_users_role CHECK (role IN ('CUSTOMER','PHARMACY','ADMIN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS pharmacyverificationevents (
  id CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  pharmacy_id CHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.pharmacyId'))) STORED,
  changed_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.changedAt'))) STORED,
  request_id VARCHAR(80) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.requestId'))) STORED,
  KEY idx_pharmacy_verification_cursor_v2 (pharmacy_id, changed_at DESC, id DESC, request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  family_id CHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.familyId'))) STORED,
  user_id CHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.userId'))) STORED,
  state VARCHAR(16) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.state'))) STORED,
  expires_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.expiresAt'))) STORED,
  KEY idx_refresh_family_state (family_id,state),
  KEY idx_refresh_user_id (user_id),
  KEY idx_refresh_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS email_outbox (
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  kind VARCHAR(32) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.kind'))) STORED,
  status VARCHAR(20) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.status'))) STORED,
  next_attempt_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.nextAttemptAt'))) STORED,
  locked_until VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.lockedUntil'))) STORED,
  created_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.createdAt'))) STORED,
  purge_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.purgeAt'))) STORED,
  user_id CHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.userId'))) STORED,
  token_hash CHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.tokenHash'))) STORED,
  KEY idx_email_outbox_due (status,next_attempt_at,locked_until),
  KEY idx_email_outbox_status_age (kind,status,created_at),
  KEY idx_email_outbox_verification_recovery (kind,user_id,token_hash,status),
  KEY idx_email_outbox_purge (purge_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS security_operations (
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  actor_id CHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.actorId'))) STORED,
  expires_at VARCHAR(24) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.expiresAt'))) STORED,
  KEY idx_security_operations_expiry (expires_at),
  KEY idx_security_operations_actor_id (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  name VARCHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.name'))) STORED,
  UNIQUE KEY uniq_schema_migrations_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
