-- Run once against the existing pharmacy_marketplace_demo MySQL database.
-- The password here MUST match DB_PASSWORD in your .env file.
CREATE USER IF NOT EXISTS 'pharmacy_api'@'%' IDENTIFIED BY 'change-me-api-db-password';
ALTER USER 'pharmacy_api'@'%' IDENTIFIED BY 'change-me-api-db-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON pharmacy_marketplace_demo.* TO 'pharmacy_api'@'%';
FLUSH PRIVILEGES;
