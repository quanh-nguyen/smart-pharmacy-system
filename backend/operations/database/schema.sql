-- Schema MySQL 8 / MariaDB 10.5+ cho 4 module: Prescriptions, Orders, Notifications, Symptoms
-- Khớp với các model Sequelize trong src/models. Có thể import bằng phpMyAdmin / MySQL Workbench,
-- hoặc chạy `npm run db:sync` để Sequelize tự tạo bảng.
-- Các bảng users, drugs, pharmacies, inventories là BẢNG TẠM của thành viên khác (xem src/models/stubs.js).

CREATE DATABASE IF NOT EXISTS pharmacy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pharmacy;

SET NAMES utf8mb4;

-- ================= Bảng tạm của nhóm =================

CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL,
  role        ENUM('customer','pharmacy','admin') NOT NULL DEFAULT 'customer',
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drugs (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(200) NOT NULL,
  active_ingredient  VARCHAR(255) NULL,
  strength           VARCHAR(50)  NULL,
  dosage_form        VARCHAR(100) NULL,
  is_prescription    TINYINT(1) NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL,
  updated_at         DATETIME NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pharmacies (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(200) NOT NULL,
  owner_id    INT UNSIGNED NOT NULL,
  address     VARCHAR(300) NULL,
  phone       VARCHAR(20)  NULL,
  verified    TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_pharmacies_owner FOREIGN KEY (owner_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventories (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pharmacy_id  INT UNSIGNED NOT NULL,
  drug_id      INT UNSIGNED NOT NULL,
  quantity     INT UNSIGNED NOT NULL DEFAULT 0,
  price        INT UNSIGNED NOT NULL COMMENT 'VND',
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventories_pharmacy_drug (pharmacy_id, drug_id),
  CONSTRAINT fk_inventories_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_inventories_drug FOREIGN KEY (drug_id) REFERENCES drugs (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= Prescriptions =================

CREATE TABLE IF NOT EXISTS prescriptions (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id         INT UNSIGNED NOT NULL,
  file_path           VARCHAR(500) NOT NULL,
  file_original_name  VARCHAR(255) NULL,
  file_mime_type      VARCHAR(100) NULL,
  file_size           INT UNSIGNED NULL,
  status              ENUM('uploaded','processing','ocr_done','confirmed','failed') NOT NULL DEFAULT 'uploaded',
  ocr_text            MEDIUMTEXT NULL,
  doctor_name         VARCHAR(150) NULL,
  issued_at           DATE NULL,
  error_message       VARCHAR(500) NULL,
  confirmed_at        DATETIME NULL,
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_prescriptions_customer (customer_id, created_at),
  KEY idx_prescriptions_status (status),
  CONSTRAINT fk_prescriptions_customer FOREIGN KEY (customer_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescription_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  prescription_id  INT UNSIGNED NOT NULL,
  drug_id          INT UNSIGNED NULL COMMENT 'NULL = chưa khớp danh mục',
  raw_text         VARCHAR(500) NULL,
  drug_name        VARCHAR(200) NOT NULL,
  strength         VARCHAR(50)  NULL,
  match_score      FLOAT NULL,
  quantity         INT UNSIGNED NOT NULL DEFAULT 1,
  instructions     VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_prescription_items_prescription (prescription_id),
  CONSTRAINT fk_prescription_items_prescription FOREIGN KEY (prescription_id) REFERENCES prescriptions (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_prescription_items_drug FOREIGN KEY (drug_id) REFERENCES drugs (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= Orders =================

CREATE TABLE IF NOT EXISTS orders (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id       INT UNSIGNED NOT NULL,
  pharmacy_id       INT UNSIGNED NOT NULL,
  prescription_id   INT UNSIGNED NULL,
  total_amount      INT UNSIGNED NOT NULL COMMENT 'VND',
  status            ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NOT NULL DEFAULT 'pending',
  shipping_address  VARCHAR(300) NOT NULL,
  phone             VARCHAR(15)  NOT NULL,
  note              VARCHAR(500) NULL,
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_orders_customer (customer_id, created_at),
  KEY idx_orders_pharmacy (pharmacy_id, status, created_at),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_prescription FOREIGN KEY (prescription_id) REFERENCES prescriptions (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id         INT UNSIGNED NOT NULL,
  drug_id          INT UNSIGNED NOT NULL,
  name             VARCHAR(255) NOT NULL COMMENT 'tên thuốc lúc đặt',
  quantity         INT UNSIGNED NOT NULL,
  unit_price       INT UNSIGNED NOT NULL COMMENT 'giá lúc đặt (VND)',
  is_prescription  TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_drug FOREIGN KEY (drug_id) REFERENCES drugs (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_history (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     INT UNSIGNED NOT NULL,
  from_status  ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NULL,
  to_status    ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NOT NULL,
  changed_by   INT UNSIGNED NULL,
  role         VARCHAR(20)  NULL,
  note         VARCHAR(500) NULL,
  created_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order_status_history_order (order_id),
  CONSTRAINT fk_order_status_history_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_status_history_user FOREIGN KEY (changed_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= Notifications =================

CREATE TABLE IF NOT EXISTS notifications (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  type        VARCHAR(50)   NOT NULL,
  title       VARCHAR(200)  NOT NULL,
  message     VARCHAR(1000) NOT NULL,
  data        JSON NULL,
  read_at     DATETIME NULL,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= Symptoms =================

CREATE TABLE IF NOT EXISTS symptom_questionnaires (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(50)  NOT NULL,
  version      INT UNSIGNED NOT NULL DEFAULT 1,
  title        VARCHAR(200) NOT NULL,
  description  TEXT NULL,
  status       ENUM('draft','approved','archived') NOT NULL DEFAULT 'draft',
  questions    JSON NOT NULL,
  rules        JSON NOT NULL,
  disclaimer   TEXT NULL,
  created_by   INT UNSIGNED NULL,
  approved_by  INT UNSIGNED NULL,
  approved_at  DATETIME NULL,
  created_at   DATETIME NOT NULL,
  updated_at   DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_symptom_questionnaires_code_version (code, version),
  KEY idx_symptom_questionnaires_status (status),
  CONSTRAINT fk_symptom_questionnaires_creator FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_symptom_questionnaires_approver FOREIGN KEY (approved_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
