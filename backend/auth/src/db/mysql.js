'use strict';
// Native mysql2 connection pool and InnoDB transactions. No MongoDB client is used.
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const mysql = require('mysql2/promise');
const env = require('../config/env');
const txContext = new AsyncLocalStorage();
let pool;
let maintenanceMode = false;
const tables = new Set(['users', 'pharmacyverificationevents', 'refresh_sessions',
  'email_outbox', 'security_operations', 'schema_migrations']);

class ObjectId {
  constructor(hex) {
    if (hex !== undefined && !/^[a-f0-9]{24}$/i.test(String(hex))) throw new Error('Invalid ID');
    this.hex = hex ? String(hex).toLowerCase() : crypto.randomBytes(12).toString('hex');
  }
  toString() { return this.hex; }
  toJSON() { return this.hex; }
  valueOf() { return this.hex; }
}
const isValidObjectId = (v) => /^[a-f0-9]{24}$/i.test(String(v ?? ''));
const useMaintenancePrincipal = () => {
  if (pool) throw new Error('Cannot switch database principal after pool initialization');
  if (!env.mysqlMaintenanceUser || !env.mysqlMaintenancePassword) throw new Error('Configure MYSQL_MAINTENANCE_USER and MYSQL_MAINTENANCE_PASSWORD');
  maintenanceMode = true;
};
const getPool = () => {
  if (!pool) {
    pool = mysql.createPool({ host: env.mysqlHost, port: env.mysqlPort,
      user: maintenanceMode ? env.mysqlMaintenanceUser : env.mysqlUser,
      password: maintenanceMode ? env.mysqlMaintenancePassword : env.mysqlPassword,
      database: env.mysqlDatabase,
      connectionLimit: env.mysqlPoolSize, waitForConnections: true, queueLimit: 0,
      timezone: 'Z', dateStrings: true, namedPlaceholders: false });
  }
  return pool;
};
const normaliseError = (err) => {
  if (err?.code === 'ER_DUP_ENTRY') {
    err.code = 11000;
    err.keyPattern = { [String(err.sqlMessage || '').includes('uniq_users_email') ? 'email' : '_id']: 1 };
  } else if (err?.code === 'ER_LOCK_DEADLOCK' || err?.code === 'ER_LOCK_WAIT_TIMEOUT') {
    err.code = 112;
    err.hasErrorLabel = (label) => label === 'TransientTransactionError';
  }
  return err;
};
const execute = async (sql, params = [], session) => {
  try {
    const client = session?.conn || txContext.getStore()?.conn || getPool();
    return await client.execute(sql, params);
  } catch (err) { throw normaliseError(err); }
};
const query = execute;
const queryRaw = async (sql) => {
  try { return await getPool().query(sql); }
  catch (err) { throw normaliseError(err); }
};
const connect = async () => {
  const connection = await getPool().getConnection();
  try { await connection.ping(); } finally { connection.release(); }
};
const disconnect = async () => {
  if (pool) { const old = pool; pool = null; await old.end(); }
};
class Session {
  constructor() { this.conn = null; }
  async withTransaction(callback) {
    if (this.conn) throw new Error('Transaction already started');
    const connection = await getPool().getConnection();
    this.conn = connection;
    let inTransaction = false;
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      inTransaction = true;
      const result = await txContext.run(this, callback);
      try { await connection.commit(); inTransaction = false; }
      catch (err) {
        // A lost connection during COMMIT may mean that the transaction committed.
        if (['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT'].includes(err?.code)) {
          err.hasErrorLabel = (label) => label === 'UnknownTransactionCommitResult';
        }
        throw err;
      }
      return result;
    } catch (err) {
      if (inTransaction) await connection.rollback().catch(() => {});
      throw normaliseError(err);
    } finally {
      this.conn = null;
      connection.release();
    }
  }
  async endSession() { /* withTransaction owns the connection lifetime */ }
}
const startSession = async () => new Session();

// Keep the original collection service boundaries, but execute SQL, not BSON commands.
const collection = (name) => {
  if (!tables.has(name)) throw new Error('Unexpected MySQL table name');
  return require('./query').collection(name);
};
const connection = {
  get readyState() { return pool ? 1 : 0; },
  collection,
};
module.exports = { ObjectId, Types: { ObjectId }, isValidObjectId,
  getPool, useMaintenancePrincipal, execute, query, queryRaw, connect, disconnect, startSession,
  connection, normaliseError, currentSession: () => txContext.getStore() };
