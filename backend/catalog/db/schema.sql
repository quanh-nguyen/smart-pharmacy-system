-- MySQL 8.0+
-- Gom cac bang ma 4 module nay dung (thuoc nhom "CSDL Hieu thuoc" va "CSDL Thuoc" trong so do he thong).
-- Cac bang khac (users, orders, allergies...) do dev khac them.
-- Toa do luu theo thu tu POINT(kinh do, vi do) = POINT(lng, lat), khong dat SRID.

CREATE DATABASE IF NOT EXISTS pharmacy_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pharmacy_platform;

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
  owner_id            INT NULL,                 -- tai khoan chu nha thuoc (bang users do dev khac lam, chua co khoa ngoai)
  verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', -- admin xac thuc nha thuoc
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  SPATIAL INDEX idx_pharmacies_location (location),
  INDEX idx_pharmacies_status (verification_status)
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

-- ===== Du lieu mau de test nhanh (khu vuc Ha Noi) =====
-- Chay lai file nhieu lan van an toan: moi bang chi duoc nap mau khi bang do con TRONG.
-- Bang da co du lieu thi khong bi chen them, khong bi xoa. Khoa ngoai cua inventory tra theo TEN,
-- khong phu thuoc vao ID tu tang.
INSERT INTO pharmacies (name, address, district, phone, opening_time, closing_time, location, search_text, verification_status)
SELECT v.name, v.address, v.district, v.phone, v.opening_time, v.closing_time, ST_GeomFromText(v.wkt), v.search_text, v.status
FROM (
  SELECT 'Nha thuoc An Khang' AS name, '12 Hang Bai, Hoan Kiem, Ha Noi' AS address, 'Hoan Kiem' AS district, '0901000001' AS phone, '07:00' AS opening_time, '22:00' AS closing_time, 'POINT(105.8497 21.0245)' AS wkt, 'nha thuoc an khang 12 hang bai, hoan kiem, ha noi hoan kiem' AS search_text, 'approved' AS status
  UNION ALL SELECT 'Nha thuoc Minh Chau', '45 Tay Son, Dong Da, Ha Noi', 'Dong Da', '0901000002', '06:30', '21:30', 'POINT(105.8228 21.0079)', 'nha thuoc minh chau 45 tay son, dong da, ha noi dong da', 'approved'
  UNION ALL SELECT 'Nha thuoc Phuc Loc', '88 Cau Giay, Cau Giay, Ha Noi', 'Cau Giay', '0901000003', '07:00', '23:00', 'POINT(105.7962 21.0333)', 'nha thuoc phuc loc 88 cau giay, cau giay, ha noi cau giay', 'approved'
  UNION ALL SELECT 'Nha thuoc 24h Thanh Cong', '20 Lang Ha, Ba Dinh, Ha Noi', 'Ba Dinh', '0901000004', NULL, NULL, 'POINT(105.8120 21.0190)', 'nha thuoc 24h thanh cong 20 lang ha, ba dinh, ha noi ba dinh', 'approved'
  UNION ALL SELECT 'Nha thuoc Hoa Binh', '5 Giai Phong, Hai Ba Trung, Ha Noi', 'Hai Ba Trung', '0901000005', '08:00', '20:00', 'POINT(105.8412 21.0000)', 'nha thuoc hoa binh 5 giai phong, hai ba trung, ha noi hai ba trung', 'pending'
) AS v
WHERE NOT EXISTS (SELECT 1 FROM pharmacies);

INSERT INTO medicines (name, name_search, active_ingredient, ingredient_search, strength, category, dosage_form, unit, manufacturer, is_prescription)
SELECT v.name, v.name_search, v.active_ingredient, v.ingredient_search, v.strength, v.category, v.dosage_form, v.unit, v.manufacturer, v.is_prescription
FROM (
  SELECT 'Paracetamol 500mg' AS name, 'paracetamol 500mg' AS name_search, 'Paracetamol' AS active_ingredient, 'paracetamol' AS ingredient_search, '500mg' AS strength, 'Giam dau, ha sot' AS category, 'Vien nen' AS dosage_form, 'Hop' AS unit, 'DHG Pharma' AS manufacturer, 0 AS is_prescription
  UNION ALL SELECT 'Efferalgan 500mg', 'efferalgan 500mg', 'Paracetamol', 'paracetamol', '500mg', 'Giam dau, ha sot', 'Vien sui', 'Hop', 'UPSA', 0
  UNION ALL SELECT 'Smecta', 'smecta', 'Diosmectite', 'diosmectite', '3g', 'Tieu hoa', 'Goi bot', 'Hop', 'Ipsen', 0
  UNION ALL SELECT 'Gaviscon', 'gaviscon', 'Natri alginat', 'natri alginat', '10ml', 'Da day', 'Goi hon dich', 'Hop', 'Reckitt', 0
  UNION ALL SELECT 'Amoxicillin 500mg', 'amoxicillin 500mg', 'Amoxicillin', 'amoxicillin', '500mg', 'Khang sinh', 'Vien nang', 'Hop', 'Stada', 1
  UNION ALL SELECT 'Hapacol 650', 'hapacol 650', 'Paracetamol', 'paracetamol', '650mg', 'Giam dau, ha sot', 'Vien nen', 'Hop', 'DHG Pharma', 0
) AS v
WHERE NOT EXISTS (SELECT 1 FROM medicines);

INSERT INTO inventory (pharmacy_id, medicine_id, price, quantity)
SELECT p.id, m.id, v.price, v.quantity
FROM (
  SELECT 'Nha thuoc An Khang' AS pharmacy_name, 'Paracetamol 500mg' AS medicine_name, 15000 AS price, 100 AS quantity
  UNION ALL SELECT 'Nha thuoc An Khang', 'Smecta', 32000, 40
  UNION ALL SELECT 'Nha thuoc An Khang', 'Gaviscon', 85000, 20
  UNION ALL SELECT 'Nha thuoc Minh Chau', 'Paracetamol 500mg', 14000, 60
  UNION ALL SELECT 'Nha thuoc Minh Chau', 'Efferalgan 500mg', 45000, 30
  UNION ALL SELECT 'Nha thuoc Minh Chau', 'Smecta', 30000, 0
  UNION ALL SELECT 'Nha thuoc Minh Chau', 'Hapacol 650', 21000, 25
  UNION ALL SELECT 'Nha thuoc Phuc Loc', 'Paracetamol 500mg', 16000, 80
  UNION ALL SELECT 'Nha thuoc Phuc Loc', 'Smecta', 33000, 25
  UNION ALL SELECT 'Nha thuoc Phuc Loc', 'Gaviscon', 88000, 10
  UNION ALL SELECT 'Nha thuoc Phuc Loc', 'Amoxicillin 500mg', 60000, 15
  UNION ALL SELECT 'Nha thuoc 24h Thanh Cong', 'Paracetamol 500mg', 15500, 50
  UNION ALL SELECT 'Nha thuoc 24h Thanh Cong', 'Smecta', 31000, 15
  UNION ALL SELECT 'Nha thuoc 24h Thanh Cong', 'Hapacol 650', 22000, 40
  UNION ALL SELECT 'Nha thuoc Hoa Binh', 'Paracetamol 500mg', 13000, 10
) AS v
JOIN pharmacies p ON p.name = v.pharmacy_name
JOIN medicines m ON m.name = v.medicine_name
WHERE NOT EXISTS (SELECT 1 FROM inventory);
