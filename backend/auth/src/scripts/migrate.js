'use strict';
// Schema provisioning requires a database owner/DDL-capable principal.
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../db/mysql');
const logger = require('../config/logger');
const { toLoggableError } = require('../utils/toLoggableError');

const MIGRATION = '001_mysql_auth_schema';
const migrate = async () => {
  const ddl = await fs.readFile(path.join(__dirname,'../../sql/001_mysql_auth_schema.sql'),'utf8');
  // DDL statements contain no strings with semicolons; each statement is executed separately.
  for (const sql of ddl.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.queryRaw(sql);
  }
  // Enforce append-only audit and immutable role at database level as well.
  const [existingTriggers] = await db.execute(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()`);
  const triggers = [
    ['users_no_role_change', `CREATE TRIGGER users_no_role_change BEFORE UPDATE ON users
      FOR EACH ROW BEGIN
        IF NOT (JSON_UNQUOTE(JSON_EXTRACT(OLD.payload,'$.role')) <=>
                JSON_UNQUOTE(JSON_EXTRACT(NEW.payload,'$.role'))) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User roles are immutable';
        END IF;
      END`],
    ['audit_no_update', `CREATE TRIGGER audit_no_update BEFORE UPDATE ON pharmacyverificationevents
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only'`],
    ['audit_no_delete', `CREATE TRIGGER audit_no_delete BEFORE DELETE ON pharmacyverificationevents
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only'`]
  ];
  for (const [name, sql] of triggers) {
    if (!existingTriggers.some((row) => row.TRIGGER_NAME === name)) await db.queryRaw(sql);
  }
  const now = new Date().toISOString();
  await db.execute('INSERT INTO schema_migrations (id, payload) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE id=id',
    [MIGRATION, JSON.stringify({ name: MIGRATION, appliedAt: now })]);
  logger.info({ migration: MIGRATION }, 'MySQL schema migration completed');
};
if (require.main === module) migrate().catch((err) => {
  logger.error({ err: toLoggableError(err) }, 'MySQL schema migration failed');
  process.exitCode=1;
}).finally(() => db.disconnect());
module.exports = { migrate, MIGRATION };
