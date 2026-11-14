-- Adds the public "suggest a pharmacy" form used by the customer-facing site.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS pharmacy_suggestions (
    suggestion_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    pharmacy_name VARCHAR(255) NOT NULL,
    address VARCHAR(1000) NOT NULL,
    phone VARCHAR(30) NULL,
    opening_hours TEXT NULL,
    website VARCHAR(500) NULL,
    additional_info TEXT NULL,
    review_status ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME NULL,
    review_remarks TEXT NULL,
    submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (suggestion_id),
    KEY idx_pharmacy_suggestions_status_date (review_status, submitted_at),
    CONSTRAINT fk_pharmacy_suggestions_reviewer
        FOREIGN KEY (reviewed_by) REFERENCES users(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
