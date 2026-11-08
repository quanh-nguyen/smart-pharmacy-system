-- Shared catalog; no sample records are inserted. MySQL 8 only.
CREATE TABLE IF NOT EXISTS pharmacies (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(150) NOT NULL,
  address             VARCHAR(255) NOT NULL,
  district            VARCHAR(100) NULL,        -- quan/huyen (khu vuc)
  phone               VARCHAR(20) NULL,
  opening_time        TIME NULL,                -- NULL ca 2 cot gio = mo cua ca ngay
  closing_time        TIME NULL,                -- closing < opening = mo qua nua dem
  location            POINT NOT NULL,
  search_text         VARCHAR(500) NOT NULL,    -- ten + dia chi + khu vuc da bo dau, de tim khong dau
  owner_id            CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,                 -- tai khoan chu nha thuoc (bang users do dev khac lam, chua co khoa ngoai)
  verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', -- admin xac thuc nha thuoc
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  SPATIAL INDEX idx_pharmacies_location (location),
  INDEX idx_pharmacies_status (verification_status),
  UNIQUE KEY uniq_pharmacy_owner (owner_id),
  CONSTRAINT fk_pharmacy_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS medicines (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,   -- ten thuong mai
  name_search       VARCHAR(200) NOT NULL,   -- ten da bo dau + chu thuong, de tim khong dau
  active_ingredient VARCHAR(200) NULL,       -- hoat chat
  ingredient_search VARCHAR(200) NULL,       -- hoat chat da bo dau + chu thuong
  strength          VARCHAR(50) NULL,        -- ham luong, vd 500mg
  category          VARCHAR(80) NULL,
  dosage_form       VARCHAR(50) NULL,        -- vien nen, siro, goi...
  unit              VARCHAR(30) NULL,        -- hop, vi, chai...
  manufacturer      VARCHAR(150) NULL,
  description       TEXT NULL,
  is_prescription   TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = thuoc ke don
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_medicines_name_search (name_search),
  INDEX idx_medicines_ingredient (ingredient_search),
  INDEX idx_medicines_category (category)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  pharmacy_id INT NOT NULL,
  medicine_id INT NOT NULL,
  price       DECIMAL(12,0) NOT NULL,
  quantity    INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (pharmacy_id, medicine_id),
  INDEX idx_inventory_medicine (medicine_id),
  CONSTRAINT fk_inv_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT fk_inv_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id)
) ENGINE=InnoDB;
