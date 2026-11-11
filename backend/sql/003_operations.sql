-- References shared users, pharmacies and medicines; no stub tables.
CREATE TABLE IF NOT EXISTS prescriptions (
  id                  INT NOT NULL AUTO_INCREMENT,
  customer_id         CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  file_path           VARCHAR(500) NOT NULL,
  file_original_name  VARCHAR(255) NULL,
  file_mime_type      VARCHAR(100) NULL,
  file_size           INT NULL,
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
  id               INT NOT NULL AUTO_INCREMENT,
  prescription_id  INT NOT NULL,
  drug_id          INT NULL COMMENT 'NULL = chưa khớp danh mục',
  raw_text         VARCHAR(500) NULL,
  drug_name        VARCHAR(200) NOT NULL,
  strength         VARCHAR(50)  NULL,
  match_score      FLOAT NULL,
  quantity         INT NOT NULL DEFAULT 1,
  instructions     VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_prescription_items_prescription (prescription_id),
  CONSTRAINT fk_prescription_items_prescription FOREIGN KEY (prescription_id) REFERENCES prescriptions (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_prescription_items_drug FOREIGN KEY (drug_id) REFERENCES medicines (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================= Orders =================

CREATE TABLE IF NOT EXISTS orders (
  id                INT NOT NULL AUTO_INCREMENT,
  customer_id       CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pharmacy_id       INT NOT NULL,
  prescription_id   INT NULL,
  total_amount      DECIMAL(14,0) NOT NULL COMMENT 'VND',
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
  id               INT NOT NULL AUTO_INCREMENT,
  order_id         INT NOT NULL,
  drug_id          INT NOT NULL,
  name             VARCHAR(255) NOT NULL COMMENT 'tên thuốc lúc đặt',
  quantity         INT NOT NULL,
  unit_price       DECIMAL(12,0) NOT NULL COMMENT 'giá lúc đặt (VND)',
  is_prescription  TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_drug FOREIGN KEY (drug_id) REFERENCES medicines (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_status_history (
  id           INT NOT NULL AUTO_INCREMENT,
  order_id     INT NOT NULL,
  from_status  ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NULL,
  to_status    ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NOT NULL,
  changed_by   CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
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
  id          INT NOT NULL AUTO_INCREMENT,
  user_id     CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
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
  id           INT NOT NULL AUTO_INCREMENT,
  code         VARCHAR(50)  NOT NULL,
  version      INT NOT NULL DEFAULT 1,
  title        VARCHAR(200) NOT NULL,
  description  TEXT NULL,
  status       ENUM('draft','approved','archived') NOT NULL DEFAULT 'draft',
  questions    JSON NOT NULL,
  rules        JSON NOT NULL,
  disclaimer   TEXT NULL,
  created_by   CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  approved_by  CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
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
