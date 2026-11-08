const crypto = require('node:crypto');
const sqlDb = require('../db/mysql');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');
const { createAccessToken } = require('../utils/token');
const accessTokenTtl = require('../utils/accessTokenTtl');

const COLLECTION = 'refresh_sessions';
const ROTATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAMILY_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const newToken = (id) => `${id}.${crypto.randomBytes(32).toString('base64url')}`;
const store = () => sqlDb.connection.collection(COLLECTION);
const invalidToken = () => new ApiError(401, 'Refresh token không hợp lệ hoặc đã hết hạn.', undefined, 'REFRESH_INVALID');

const assertEnabled = () => {
  if (!env.refreshTokensEnabled) {
    throw new ApiError(503, 'Chức năng làm mới phiên chưa được kích hoạt.', undefined, 'REFRESH_DISABLED');
  }
};

const issue = async (user, { session } = {}) => {
  assertEnabled();
  const id = new sqlDb.Types.ObjectId();
  const familyId = new sqlDb.Types.ObjectId();
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + FAMILY_LIFETIME_MS);
  const token = newToken(id.toString());
  await store().insertOne({
    _id: id,
    familyId,
    userId: user._id,
    tokenHash: sha256(token),
    tokenVersion: user.tokenVersion ?? 0,
    state: 'active',
    // TTL must retain consumed token hashes until the family absolute expiry for replay detection.
    expiresAt: absoluteExpiresAt,
    validUntil: new Date(now.getTime() + ROTATION_TTL_MS),
    absoluteExpiresAt,
    createdAt: now,
    revokedAt: null
  }, { session });
  return token;
};

const revokeFamily = async (familyId, reason) => {
  const result = await store().updateMany(
    { familyId, state: { $ne: 'revoked' } },
    { $set: { state: 'revoked', revokedAt: new Date(), revokeReason: reason } }
  );
  return result.modifiedCount;
};

const checkKnownReplay = async (id, tokenHash) => {
  // A guessed ObjectId without matching tokenHash must never revoke a family.
  const old = await store().findOne({ _id: id, tokenHash });
  if (old?.state === 'consumed' && old.familyId) {
    await revokeFamily(old.familyId, 'refresh_token_reuse');
    logger.warn({ event: 'refresh_token_reuse_detected' }, 'Refresh session family revoked after replay');
  }
};

const rotate = async (token) => {
  assertEnabled();
  if (typeof token !== 'string' || !/^[0-9a-f]{24}\.[a-zA-Z0-9_-]{43}$/.test(token)) {
    throw invalidToken();
  }
  const id = new sqlDb.Types.ObjectId(token.slice(0, 24));
  const presentedHash = sha256(token);
  const now = new Date();
  const descendantId = new sqlDb.Types.ObjectId();
  const replacement = newToken(descendantId.toString());
  const session = await sqlDb.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // CAS + transaction: only one concurrent request may consume a given token.
      const previous = await store().findOneAndUpdate({
        _id: id,
        tokenHash: presentedHash,
        state: 'active',
        validUntil: { $gt: now },
        absoluteExpiresAt: { $gt: now },
        revokedAt: null
      }, { $set: { state: 'consumed', consumedAt: now } },
      { returnDocument: 'before', session });
      if (!previous) throw invalidToken();
      const user = await User.findById(previous.userId).select('+tokenVersion').session(session);
      if (!user || user.isActive !== true || user.tokenVersion !== previous.tokenVersion) {
        throw invalidToken();
      }
      const validUntil = new Date(Math.min(now.getTime() + ROTATION_TTL_MS,
        previous.absoluteExpiresAt.getTime()));
      await store().insertOne({
        _id: descendantId,
        familyId: previous.familyId,
        userId: previous.userId,
        tokenHash: sha256(replacement),
        tokenVersion: previous.tokenVersion,
        state: 'active',
        expiresAt: previous.absoluteExpiresAt,
        validUntil,
        absoluteExpiresAt: previous.absoluteExpiresAt,
        createdAt: now,
        parentId: id,
        revokedAt: null
      }, { session });
      result = {
        accessToken: createAccessToken(user),
        tokenType: 'Bearer',
        expiresIn: accessTokenTtl(),
        refreshToken: replacement
      };
    });
  } catch (error) {
    // MySQL may report an unknown commit result even after both writes committed.
    // Do not interpret transport/commit uncertainty as a proven replay and revoke
    // the family here. A client must not automatically retry the old token.
    if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      logger.warn({ event: 'refresh_commit_outcome_unknown' }, 'Refresh commit outcome requires reconciliation');
      throw new ApiError(503, 'Không thể xác nhận kết quả làm mới phiên; không tự động thử lại.',
        undefined, 'REFRESH_COMMIT_UNKNOWN');
    }
    // Must run OUTSIDE the aborted transaction; only a matching consumed hash triggers revocation.
    await checkKnownReplay(id, presentedHash);
    if (error instanceof ApiError && error.statusCode === 401) throw error;
    // On concurrent write conflict, observe the committed predecessor and deny replay.
    if (error?.code === 112 || error?.hasErrorLabel?.('TransientTransactionError')) {
      throw invalidToken();
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return result;
};

const revokeForUser = async (userId, { session } = {}) => {
  if (!env.refreshTokensEnabled) return;
  await store().updateMany(
    { userId: new sqlDb.Types.ObjectId(userId), state: 'active' },
    { $set: { state: 'revoked', revokedAt: new Date(), revokeReason: 'account_revoke' } },
    { session }
  );
};

module.exports = { issue, rotate, revokeForUser, revokeFamily, checkKnownReplay };
