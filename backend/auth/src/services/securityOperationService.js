const crypto = require('node:crypto');
const sqlDb = require('../db/mysql');
const ApiError = require('../utils/ApiError');

const collection = () => sqlDb.connection.collection('security_operations');
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A supplied UUID is an idempotency key, never a bearer credential. Scope it to
// the authenticated actor + action; no secrets or request bodies are stored.
const makeOperationId = (actorId, action, idempotencyKey) => {
  if (idempotencyKey === undefined) return crypto.randomUUID();
  if (typeof idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    throw new ApiError(400, 'Idempotency-Key phải là UUID hợp lệ.', undefined, 'INVALID_IDEMPOTENCY_KEY');
  }
  return crypto.createHash('sha256')
    .update(`${actorId}:${action}:${idempotencyKey.toLowerCase()}`).digest('hex');
};
const get = (actorId, operationId) => collection().findOne({ _id: operationId,
  actorId: new sqlDb.Types.ObjectId(actorId) },
{ projection: { action: 1, targetId: 1, status: 1, createdAt: 1, result: 1 } });

const record = async ({ operationId, actorId, targetId, action, result }, session) => {
  const now = new Date();
  await collection().insertOne({
    _id: operationId, actorId: new sqlDb.Types.ObjectId(actorId),
    targetId: new sqlDb.Types.ObjectId(targetId), action,
    status: 'committed', result, createdAt: now,
    expiresAt: new Date(now.getTime() + MAX_AGE_MS)
  }, { session });
};
const prior = async ({ operationId, actorId, targetId, action }) => {
  const found = await get(actorId, operationId);
  if (!found) return null;
  if (found.action !== action || String(found.targetId || targetId) !== String(targetId)) {
    throw new ApiError(409, 'Idempotency key xung đột.', undefined, 'IDEMPOTENCY_CONFLICT');
  }
  return found;
};
module.exports = { makeOperationId, record, prior, get };
