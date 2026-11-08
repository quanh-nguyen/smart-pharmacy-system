'use strict';
// Dedicated, connection-scoped MySQL advisory lock for maintenance-only CLI jobs.
const db = require('../db/mysql');
const LOCK_ID = 'smart-medicine-schema-migrations';
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const acquireMigrationLock = async (_collection, _options={}) => {
  const conn = await db.getPool().getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_ID]);
    if (rows[0].acquired !== 1) {
      const err = new Error('Another maintenance runner owns the MySQL migration lock.');
      err.code='MIGRATION_LOCK_HELD'; throw err;
    }
    return { conn };
  } catch (err) { conn.release(); throw err; }
};
const assertMigrationLockOwned = async (_collection, owner) => {
  if (!owner?.conn) throw new Error('Maintenance lock not acquired.');
  const [rows] = await owner.conn.query('SELECT IS_USED_LOCK(?) AS holder, CONNECTION_ID() AS mine', [LOCK_ID]);
  if (!rows.length || String(rows[0].holder) !== String(rows[0].mine)) {
    const error=new Error('Maintenance lock is no longer held.');
    error.code='MIGRATION_LOCK_LOST'; throw error;
  }
};
const renewMigrationLock = async (collection, owner) => {
  await assertMigrationLockOwned(collection, owner); return true;
};
const releaseMigrationLock = async (_collection, owner) => {
  if (!owner?.conn) return;
  try { await owner.conn.query('SELECT RELEASE_LOCK(?)', [LOCK_ID]); }
  finally { owner.conn.release(); }
};
module.exports = { LOCK_ID, DEFAULT_LEASE_MS, acquireMigrationLock,
  assertMigrationLockOwned, renewMigrationLock, releaseMigrationLock };
