-- MEDIBRIDGE - standalone, isolated DEMO schema for MySQL 8.0+
-- Import ONLY into medibridge_demo. NEVER use your team's production database.
-- This script creates tables; it does not DROP, truncate or overwrite anything.
CREATE TABLE IF NOT EXISTS pharmacies (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  address VARCHAR(255) NOT NULL,
  district VARCHAR(100),
  phone VARCHAR(25),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  opening_time CHAR(5),
  closing_time CHAR(5),
  verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  active TINYINT(1) NOT NULL DEFAULT 1,
  owner_user_id INT UNSIGNED DEFAULT NULL,
  INDEX idx_pharmacies_status (active,verification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  role ENUM('customer','pharmacy','admin') NOT NULL DEFAULT 'customer',
  pharmacy_id INT UNSIGNED DEFAULT NULL,
  CONSTRAINT fk_user_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS medicines (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  ingredient VARCHAR(150),
  strength VARCHAR(50),
  category VARCHAR(150),
  is_prescription TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory (
  pharmacy_id INT UNSIGNED NOT NULL,
  medicine_id INT UNSIGNED NOT NULL,
  price INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  PRIMARY KEY(pharmacy_id,medicine_id),
  CONSTRAINT fk_inventory_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT fk_inventory_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prescriptions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  items_json JSON NOT NULL,
  status ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  created_at VARCHAR(35) NOT NULL,
  INDEX idx_prescriptions_user (user_id,id),
  CONSTRAINT fk_prescriptions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  pharmacy_id INT UNSIGNED NOT NULL,
  prescription_id INT UNSIGNED DEFAULT NULL,
  status ENUM('pending','confirmed','preparing','delivering','completed','rejected','cancelled') NOT NULL DEFAULT 'pending',
  shipping_address VARCHAR(255) NOT NULL,
  phone VARCHAR(25) NOT NULL,
  total BIGINT UNSIGNED NOT NULL,
  note VARCHAR(300) NOT NULL DEFAULT '',
  created_at VARCHAR(35) NOT NULL,
  updated_at VARCHAR(35) NOT NULL,
  INDEX idx_orders_user (user_id, id),
  INDEX idx_orders_pharmacy (pharmacy_id, status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_pharmacy FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id),
  CONSTRAINT fk_orders_prescription FOREIGN KEY (prescription_id) REFERENCES prescriptions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  order_id INT UNSIGNED NOT NULL,
  medicine_id INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price INT UNSIGNED NOT NULL,
  PRIMARY KEY(order_id, medicine_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_medicine FOREIGN KEY (medicine_id) REFERENCES medicines(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at VARCHAR(35),
  created_at VARCHAR(35) NOT NULL,
  INDEX idx_notifications_user (user_id,id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
