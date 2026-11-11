'use strict';
const db = require('../db/mysql');
const logger = require('./logger');
const required = {
  users: ['PRIMARY','uniq_users_email','idx_users_role_created_id',
    'idx_users_role_verification_created_id','idx_users_email_verification_hash'],
  pharmacyverificationevents: ['PRIMARY','idx_pharmacy_verification_cursor_v2'],
  refresh_sessions: ['PRIMARY','idx_refresh_family_state','idx_refresh_user_id','idx_refresh_expires_at'],
  email_outbox: ['PRIMARY','idx_email_outbox_due','idx_email_outbox_status_age',
    'idx_email_outbox_verification_recovery','idx_email_outbox_purge'],
  security_operations: ['PRIMARY','idx_security_operations_expiry'],
  schema_migrations: ['PRIMARY','uniq_schema_migrations_name']
};
const assertRequiredIndexes = async () => {
  const [rows] = await db.execute(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE FROM information_schema.statistics
    WHERE TABLE_SCHEMA = DATABASE()`);
  for (const [table, indexes] of Object.entries(required)) {
    for (const index of indexes) {
      if (!rows.some((row) => row.TABLE_NAME === table && row.INDEX_NAME === index)) {
        throw new Error(`Missing required MySQL index ${table}.${index}; run npm run migrate`);
      }
    }
  }
  if (!rows.some((row) => row.TABLE_NAME === 'users' && row.INDEX_NAME === 'uniq_users_email' && row.NON_UNIQUE === 0)) {
    throw new Error('MySQL email index must be unique');
  }
};
const assertRequiredMigrations = async () => {
  const marker = await db.connection.collection('schema_migrations')
    .findOne({ name: '001_mysql_auth_schema' });
  if (!marker) throw new Error('MySQL migrations not applied: run npm run migrate');
};
const assertRequiredTriggers = async () => {
  const [rows] = await db.execute(`SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE()`);
  for (const name of ['users_no_role_change','audit_no_update','audit_no_delete']) {
    if (!rows.some((row) => row.TRIGGER_NAME === name))
      throw new Error(`Missing MySQL security trigger: ${name}; run npm run migrate`);
  }
};
const connectDB = async () => {
  await db.connect();
  await assertRequiredMigrations();
  await assertRequiredIndexes();
  await assertRequiredTriggers();
  logger.info('MySQL connected; required migrations and indexes verified');
};
module.exports = connectDB;
module.exports.assertRequiredMigrations = assertRequiredMigrations;
module.exports.assertRequiredIndexes = assertRequiredIndexes;
module.exports.REQUIRED_MIGRATIONS = ['001_mysql_auth_schema'];

module.exports.assertRequiredTriggers = assertRequiredTriggers;
