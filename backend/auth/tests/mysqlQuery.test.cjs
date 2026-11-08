'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
class ObjectId {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}
let calls = [], results = [];
const fakeDb = {
  ObjectId, currentSession: () => null,
  execute: async (sql, params=[]) => {
    calls.push({ sql, params });
    if (!results.length) throw new Error('Unexpected SQL statement: ' + sql);
    return results.shift();
  },
  startSession: async () => ({ withTransaction: async (cb) => cb(), endSession: async () => {} })
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './mysql' && parent?.filename?.endsWith('/src/db/query.js')) return fakeDb;
  return originalLoad.apply(this,arguments);
};
const Q = require('../src/db/query');
Module._load = originalLoad;
const reset = (...payloads) => { calls=[]; results=[...payloads]; };

test('compiled filters use placeholders, indexed fields, SQL comparisons and OR', () => {
  const f = Q.compile('users', { $and: [
    { role: 'ADMIN', mfaEnabled: true },
    { $or: [{ mfaLastUsedStep: { $lt: 7 } }, { mfaLastUsedStep: null }] }
  ] });
  assert.match(f.sql, /`role` = \?/);
  assert.match(f.sql, /JSON_UNQUOTE\(JSON_EXTRACT\(payload/);
  assert.match(f.sql, / OR /);
  assert.deepEqual(f.params, ['ADMIN','true',7]);
  assert.throws(() => Q.compile('users', { 'email` OR 1=1': 'bad' }), /Unsupported/);
});

test('MySQL read restores dates and applies hidden-field / selected-field rules', async () => {
  const id='0123456789abcdef01234567';
  const user = { _id:id, role:'CUSTOMER', email:'alice@example.org',
    createdAt:'2026-11-04T08:00:00.000Z', password:'bcrypt-hash', tokenVersion:4 };
  delete user._id;
  reset([[{ id, payload: JSON.stringify(user) }]]);
  const output = await new Q.Query('users',{email:'alice@example.org'}, {},'one')._run();
  assert.equal(output.email, 'alice@example.org');
  assert.equal(output.password, undefined);
  assert.equal(output._id,id);
  assert.ok(output.createdAt instanceof Date);
  reset([[{ id, payload: JSON.stringify(user) }]]);
  const secret = await new Q.Query('users',{_id:id}, {},'one').select('+password +tokenVersion')._run();
  assert.equal(secret.password, 'bcrypt-hash');
  assert.equal(secret.tokenVersion,4);
});

test('CAS updates remain one atomic UPDATE with JSON modifiers and placeholders', async () => {
  reset([{ affectedRows:1,changedRows:1 }]);
  const result = await Q.update('users', {_id:'0123456789abcdef01234567',tokenVersion:3},
    { $set: {isActive:false}, $inc: {tokenVersion:1}, $unset: {emailVerificationHash:''} });
  assert.equal(result.matchedCount,1);
  assert.match(calls[0].sql,/^UPDATE `users` SET payload=JSON_REMOVE/);
  assert.match(calls[0].sql,/JSON_SET/);
  assert.match(calls[0].sql,/`id` = \?/);
  assert.deepEqual(calls[0].params.slice(-2), ['0123456789abcdef01234567',3]);
});

test('mail claim uses SELECT FOR UPDATE and writes with transaction context', async () => {
  const id='0123456789abcdef01234567';
  const before={ _id:id, status:'pending', lockedUntil:null };
  reset([[{id, payload: JSON.stringify({ status:'pending', lockedUntil:null })}]],
    [{ affectedRows:1,changedRows:1 }]);
  const result=await Q.findOneAndUpdate('email_outbox',{ _id:id,status:'pending' },
    {$set: {status:'sending'}}, {returnDocument:'before'});
  assert.equal(result.status,'pending');
  assert.match(calls[0].sql, /FOR UPDATE$/);
  assert.match(calls[1].sql, /^UPDATE/);
});

test('model SQL schema declares all core MySQL tables and constraints', async () => {
  const fs=require('node:fs'); const ddl=fs.readFileSync('sql/001_mysql_auth_schema.sql','utf8');
  for (const name of ['users','pharmacyverificationevents','refresh_sessions',
    'email_outbox','security_operations','schema_migrations']) assert.match(ddl,new RegExp(`CREATE TABLE IF NOT EXISTS ${name}`));
  assert.match(ddl,/UNIQUE KEY uniq_users_email/);
  assert.match(ddl,/idx_refresh_family_state/);
});
