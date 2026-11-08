'use strict';
// Restricted Mongo-shaped query interface translated into prepared MySQL statements.
// This adapter preserves existing service calls without adding a MongoDB dependency.
const db = require('./mysql');
const crypto = require('node:crypto');
const names = new Set(['users', 'pharmacyverificationevents', 'refresh_sessions',
  'email_outbox', 'security_operations', 'schema_migrations']);
const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'changedAt', 'verifiedAt', 'passwordChangedAt',
  'emailVerificationExpiresAt', 'expiresAt', 'validUntil', 'absoluteExpiresAt', 'revokedAt',
  'consumedAt', 'nextAttemptAt', 'lockedUntil', 'purgeAt', 'checkedAt', 'sentAt']);
const NUMBER_FIELDS = new Set(['tokenVersion', 'adminSafetyEpoch', 'mfaLastUsedStep', 'attempts']);
const BOOLEAN_FIELDS = new Set(['isActive', 'isVerified', 'emailVerified', 'mfaEnabled',
  'previousValue', 'newValue']);
const INDEXED = {
  users: new Set(['email','role','isVerified','createdAt','emailVerificationHash']),
  pharmacyverificationevents: new Set(['pharmacyId','changedAt','requestId']),
  refresh_sessions: new Set(['familyId','userId','state','expiresAt']),
  email_outbox: new Set(['kind','status','nextAttemptAt','lockedUntil','createdAt','purgeAt','userId','tokenHash']),
  security_operations: new Set(['actorId','expiresAt']), schema_migrations: new Set(['name'])
};
const camelToSnake = (name) => name.replace(/[A-Z]/g, (s) => `_${s.toLowerCase()}`);
const raw = (value) => value instanceof db.ObjectId ? String(value) : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(raw) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,raw(v)])) : value;
const encode = (value) => JSON.stringify(raw(value));
const revive = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const [key, value] of Object.entries(obj)) {
    if (DATE_FIELDS.has(key) && typeof value === 'string') obj[key] = new Date(value);
    else if (key === 'verificationHistory' && Array.isArray(value)) obj[key] = value.map(revive);
  }
  return obj;
};
const parse = (row) => {
  if (!row) return null;
  let parsed = row.payload;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString('utf8');
  if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  return revive({ ...(parsed || {}), _id: String(row.id) });
};
const table = (name) => {
  if (!names.has(name)) throw new Error('Unsafe table identifier');
  return `\`${name}\``;
};
const path = (field) => {
  if (!/^[a-zA-Z][\w]{0,63}$/.test(field)) throw new Error('Unsupported query field');
  return `$.${field}`;
};
const expression = (name, field) => {
  if (field === '_id') return '`id`';
  if (INDEXED[name]?.has(field)) return `\`${camelToSnake(field)}\``;
  const expr = `JSON_UNQUOTE(JSON_EXTRACT(payload, '${path(field)}'))`;
  if (NUMBER_FIELDS.has(field)) return `CAST(${expr} AS DECIMAL(20,0))`;
  return expr;
};
const bindValue = (value) => {
  const v = raw(value);
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
};
const compile = (name, filter = {}) => {
  const params = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Invalid query filter');
    const conditions = [];
    for (const [key, val] of Object.entries(node)) {
      if (key === '$and' || key === '$or') {
        if (!Array.isArray(val)) throw new Error('Invalid logical filter');
        conditions.push(val.length ? `(${val.map(visit).join(key === '$and' ? ' AND ' : ' OR ')})` :
          (key === '$and' ? 'TRUE' : 'FALSE'));
        continue;
      }
      const expr = expression(name, key);
      if (val === null) { conditions.push(`(${expr} IS NULL OR JSON_TYPE(JSON_EXTRACT(payload, '${path(key)}')) = 'NULL')`); continue; }
      if (val && typeof val === 'object' && !(val instanceof Date) && !(val instanceof db.ObjectId) && !Array.isArray(val)) {
        for (const [op, rhs] of Object.entries(val)) {
          if (op === '$exists') {
            const exists = key === '_id' ? 'TRUE' : `JSON_CONTAINS_PATH(payload, 'one', '${path(key)}')`;
            conditions.push(rhs ? exists : `NOT (${exists})`);
          } else if (op === '$type') {
            if (rhs !== 'string') throw new Error('Unsupported $type');
            conditions.push(`JSON_TYPE(JSON_EXTRACT(payload, '${path(key)}')) = 'STRING'`);
          } else if (op === '$in' || op === '$nin') {
            if (!Array.isArray(rhs)) throw new Error('Expected array');
            if (!rhs.length) { conditions.push(op === '$in' ? 'FALSE' : 'TRUE'); continue; }
            const placeholders = rhs.map(() => '?').join(',');
            conditions.push(`${expr} ${op === '$in' ? 'IN' : 'NOT IN'} (${placeholders})`);
            params.push(...rhs.map(bindValue));
          } else {
            const operators = { $gt: '>', $gte: '>=', $lt: '<', $lte: '<=', $ne: '<>', $eq: '=' };
            if (!operators[op]) throw new Error(`Unsupported filter operation: ${op}`);
            if (rhs === null) { conditions.push(op === '$ne' ? `${expr} IS NOT NULL` : `${expr} IS NULL`); continue; }
            if (op === '$ne') conditions.push(`(${expr} <> ? OR ${expr} IS NULL)`);
            else conditions.push(`${expr} ${operators[op]} ?`);
            params.push(bindValue(rhs));
          }
        }
      } else {
        conditions.push(`${expr} = ?`);
        params.push(bindValue(val));
      }
    }
    return conditions.length ? `(${conditions.join(' AND ')})` : 'TRUE';
  };
  return { sql: visit(filter), params };
};
const sortSql = (name, sort = {}) => Object.entries(sort || {}).map(([k, v]) => {
  if (v !== -1 && v !== 1) throw new Error('Unsupported sort direction');
  return `${expression(name, k)} ${v === -1 ? 'DESC' : 'ASC'}`;
}).join(', ');
const defaultSelectHidden = ['password','tokenVersion','emailVerificationHash','emailVerificationExpiresAt',
  'mfaSecretEncrypted','mfaPendingSecretEncrypted','mfaLastUsedStep','adminSafetyEpoch','lastSecurityOperationId'];
const project = (row, projection, model) => {
  if (!row) return null;
  let result = { ...row };
  if (model === 'users') {
    for (const hidden of defaultSelectHidden) delete result[hidden];
  }
  if (projection) {
    let entries = Object.entries(projection);
    if (typeof projection === 'string') {
      entries = projection.trim().split(/\s+/).map((term) =>
        term.startsWith('+') ? [term.slice(1), 2] : term.startsWith('-') ? [term.slice(1), 0] : [term, 1]);
    }
    const positive = entries.filter(([,v]) => v === 1 || v === true).map(([k]) => k);
    if (positive.length) {
      const picked = { _id: result._id };
      for (const field of positive) if (field in row) picked[field] = row[field];
      result = picked;
    }
    for (const [k, v] of entries) {
      if (v === 2) { if (k in row) result[k] = row[k]; }
      if (v === 0 || v === false) delete result[k];
    }
    if ((projection._id === 0 || projection._id === false) && typeof projection !== 'string') delete result._id;
  }
  return result;
};
class Query {
  constructor(name, filter, options = {}, mode = 'many', hydrated = false) {
    this.name = name; this.filter = filter || {}; this.options = { ...options };
    this.mode = mode; this.hydrated = hydrated;
  }
  sort(value) { this.options.sort = value; return this; }
  select(value) { this.options.projection = value; return this; }
  lean() { this.hydrated = false; return this; }
  session(value) { this.options.session = value; return this; }
  limit(value) { this.options.limit = value; return this; }
  skip(value) { this.options.skip = value; return this; }
  batchSize(value) { this.options.batchSize = Math.min(Math.max(Number(value) || 200, 1), 1000); return this; }
  async toArray() { return this._run(); }
  async close() { /* MySQL result sets are materialized by mysql2 */ }
  then(resolve, reject) { return this._run().then(resolve, reject); }
  catch(reject) { return this._run().catch(reject); }
  async *[Symbol.asyncIterator]() {
    // Stream bounded keyset pages instead of loading a whole legacy collection.
    // This is used by maintenance scripts; regular API list queries use LIMIT.
    if (this.mode !== 'many' || Object.keys(this.options.sort || {}).length || this.options.skip) {
      const result = await this._run();
      for (const value of Array.isArray(result) ? result : [result]) yield value;
      return;
    }
    let lastId = null;
    const batchSize = this.options.batchSize || 200;
    while (true) {
      const filter = lastId ? { $and: [this.filter, { _id: { $gt: lastId } }] } : this.filter;
      const page = await new Query(this.name,filter,
        { ...this.options, sort: { _id: 1 }, limit: batchSize },'many',this.hydrated)._run();
      for (const value of page) yield value;
      if (page.length < batchSize) break;
      lastId = page[page.length-1]._id;
      if (!lastId) throw new Error('Keyset pagination requires _id projection');
    }
  }
  async _run() {
    const filter = compile(this.name, this.filter);
    if (this.mode === 'count') {
      const [rows] = await db.execute(`SELECT COUNT(*) AS total FROM ${table(this.name)} WHERE ${filter.sql}`,
        filter.params, this.options.session);
      return Number(rows[0].total);
    }
    let sql = `SELECT id, payload FROM ${table(this.name)} WHERE ${filter.sql}`;
    const sorter = sortSql(this.name, this.options.sort);
    if (sorter) sql += ` ORDER BY ${sorter}`;
    if (this.mode === 'one' && !this.options.limit) sql += ' LIMIT 1';
    else if (this.options.limit !== undefined) sql += ` LIMIT ${Math.max(0, Number(this.options.limit) | 0)}`;
    if (this.options.skip) {
      if (!sql.includes(' LIMIT ')) sql += ' LIMIT 18446744073709551615';
      sql += ` OFFSET ${Math.max(0, Number(this.options.skip) | 0)}`;
    }
    const [rows] = await db.execute(sql, filter.params, this.options.session);
    const mapped = rows.map((r) => {
      const projected = project(parse(r), this.options.projection, this.name);
      return this.hydrated ? require('./models').hydrate(this.name, projected) : projected;
    });
    return this.mode === 'one' ? (mapped[0] || null) : mapped;
  }
}
const makeUpdate = (name, update = {}, { onInsert = false, timestamps = false } = {}) => {
  const keys = ['$set','$unset','$inc','$setOnInsert'];
  if (Object.keys(update).some((k) => !keys.includes(k))) throw new Error('Unsupported update shape');
  const chunks = []; const params = [];
  let expressionSql = 'payload';
  const set = { ...(update.$set || {}), ...(onInsert ? update.$setOnInsert || {} : {}) };
  if (timestamps) set.updatedAt = new Date();
  for (const [field, value] of Object.entries(set)) {
    const jsonPath = path(field);
    expressionSql = `JSON_SET(${expressionSql}, '${jsonPath}', CAST(? AS JSON))`;
    params.push(encode(value));
    chunks.push(field);
  }
  for (const [field, step] of Object.entries(update.$inc || {})) {
    if (!Number.isFinite(step)) throw new Error('Invalid increment');
    const jsonPath = path(field);
    expressionSql = `JSON_SET(${expressionSql}, '${jsonPath}', CAST((COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '${jsonPath}')) AS SIGNED), 0) + ?) AS JSON))`;
    params.push(step);
    chunks.push(field);
  }
  for (const field of Object.keys(update.$unset || {})) {
    expressionSql = `JSON_REMOVE(${expressionSql}, '${path(field)}')`;
    chunks.push(field);
  }
  if (!chunks.length) return null;
  return { sql: expressionSql, params };
};
const update = async (name, filter, modifier, options = {}, many = false) => {
  const filt = compile(name, filter);
  const operation = makeUpdate(name, modifier, { timestamps: name === 'users' });
  if (!operation) return { matchedCount: 0, modifiedCount: 0 };
  let sql = `UPDATE ${table(name)} SET payload=${operation.sql} WHERE ${filt.sql}`;
  if (!many) sql += ' LIMIT 1';
  const [res] = await db.execute(sql, [...operation.params, ...filt.params], options.session);
  if (res.affectedRows === 0 && options.upsert) {
    const base = Object.fromEntries(Object.entries(filter).filter(([key,value]) =>
      !key.startsWith('$') && (value === null || typeof value !== 'object' || value instanceof db.ObjectId || value instanceof Date)));
    for (const [k,v] of Object.entries(modifier.$set || {})) base[k] = v;
    for (const [k,v] of Object.entries(modifier.$setOnInsert || {})) base[k] = v;
    base._id = base._id || crypto.randomBytes(12).toString('hex');
    await insert(name, base, options);
    return { matchedCount: 0, modifiedCount: 0, upsertedId: base._id };
  }
  return { matchedCount: res.affectedRows, modifiedCount: res.changedRows ?? res.affectedRows };
};
const insert = async (name, obj, options = {}) => {
  const doc = { ...obj };
  const id = doc._id ? String(doc._id) : crypto.randomBytes(12).toString('hex');
  delete doc._id;
  await db.execute(`INSERT INTO ${table(name)} (id, payload) VALUES (?, CAST(? AS JSON))`,
    [id, encode(doc)], options.session);
  return { acknowledged: true, insertedId: id, doc: { _id: id, ...doc } };
};
// findOneAndUpdate: per-row SELECT FOR UPDATE and UPDATE within one real SQL transaction.
const findOneAndUpdate = async (name, filter, modifier, options = {}) => {
  const task = async (session) => {
    const filt = compile(name, filter);
    const sorter = sortSql(name, options.sort);
    const [rows] = await db.execute(`SELECT id,payload FROM ${table(name)} WHERE ${filt.sql}` +
      (sorter ? ` ORDER BY ${sorter}` : '') + ' LIMIT 1 FOR UPDATE', filt.params, session);
    if (!rows.length) return null;
    const previous = parse(rows[0]);
    await update(name, { _id: previous._id }, modifier, { session });
    if (options.returnDocument === 'before') return project(previous, options.projection, name);
    return new Query(name, { _id: previous._id }, { session, projection: options.projection }, 'one')._run();
  };
  if (options.session || db.currentSession()) return task(options.session || db.currentSession());
  const session = await db.startSession();
  try { return await session.withTransaction(() => task(session)); }
  finally { await session.endSession(); }
};
const bulkWrite = async (name, operations, options={}) => {
  let modifiedCount=0;
  for (const operation of operations) {
    if (operation.updateOne) {
      const { filter, update: mutation } = operation.updateOne;
      const res = await update(name, filter, mutation, options);
      modifiedCount += res.modifiedCount;
    } else throw new Error('Unsupported bulk operation');
  }
  return { modifiedCount };
};
const collection = (name) => ({
  find: (f={}, opts={}) => new Query(name, f, opts, 'many'),
  findOne: (f={}, opts={}) => new Query(name, f, opts, 'one'),
  countDocuments: (f={}) => new Query(name, f, {}, 'count'),
  insertOne: (obj,opts={}) => insert(name,obj,opts),
  bulkWrite: (ops,opts={}) => bulkWrite(name,ops,opts),
  updateOne: (f,u,opts={}) => update(name,f,u,opts,false),
  updateMany: (f,u,opts={}) => update(name,f,u,opts,true),
  findOneAndUpdate: (f,u,opts={}) => findOneAndUpdate(name,f,u,opts),
  deleteOne: async (f,opts={}) => {
    const c=compile(name,f); const [r]=await db.execute(`DELETE FROM ${table(name)} WHERE ${c.sql} LIMIT 1`,c.params,opts.session);
    return { deletedCount:r.affectedRows };
  },
  deleteMany: async (f,opts={}) => {
    const c=compile(name,f); const [r]=await db.execute(`DELETE FROM ${table(name)} WHERE ${c.sql}`,c.params,opts.session);
    return { deletedCount:r.affectedRows };
  }
});
module.exports = { Query, collection, insert, update, findOneAndUpdate, compile, parse, project,
  makeUpdate, sortSql, encode, revive };
