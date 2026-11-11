const crypto = require('node:crypto');
const sqlDb = require('../db/mysql');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const { seal } = require('../utils/mailOutboxCrypto');
const { getHealth } = require('./mailOutboxHealth');

const TTL_MS = 15 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const OUTBOX_COLLECTION = 'email_outbox';

const requestVerification = async (userId) => {
  if (!env.mailApiKey || !env.mailFrom || !env.publicAppUrl || !(env.mailOutboxEncryptionKey || env.mailOutboxActiveKeyId)) {
    throw new ApiError(503, 'Chức năng gửi email hiện chưa được cấu hình.', undefined, 'EMAIL_NOT_CONFIGURED');
  }
  const user = await User.findById(userId);
  if (!user || user.isActive !== true) throw new ApiError(401, 'Phiên không hợp lệ.');
  if (user.emailVerified) return;
  // Do not accept work into a 15-minute token queue with no live worker.
  const delivery = await getHealth();
  if (!delivery.healthy) {
    throw new ApiError(503, 'Dịch vụ gửi email đang gián đoạn. Vui lòng thử lại.',
      undefined, 'MAIL_WORKER_UNAVAILABLE');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const digest = hash(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const link = `${env.publicAppUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
  const sealedPayload = seal({ to: user.email, link });
  const session = await sqlDb.startSession();
  try {
    await session.withTransaction(async () => {
      // When a provider permanently failed, a new link can be issued after
      // cooldown. Do not rotate tokens for a pending, retrying or sending job.
      const current = await User.findById(user._id)
        .select('+emailVerificationHash +emailVerificationExpiresAt')
        .session(session);
      if (!current || current.isActive !== true || current.emailVerified) return;

      const reservedFilter = { _id: user._id, isActive: true, emailVerified: false };
      const hasActiveToken = Boolean(current.emailVerificationHash &&
        current.emailVerificationExpiresAt > now);
      if (hasActiveToken) {
        const oldJob = await sqlDb.connection.collection(OUTBOX_COLLECTION).findOne({
          kind: 'verification_email', userId: user._id,
          tokenHash: current.emailVerificationHash, status: 'dead_letter'
        }, { session, projection: { _id: 1, createdAt: 1 } });
        // The outer Redis cooldown remains authoritative. This protects the
        // service even when it is invoked outside its HTTP route.
        if (!oldJob || now.getTime() - new Date(oldJob.createdAt).getTime() < 60_000) return;
        reservedFilter.emailVerificationHash = current.emailVerificationHash;
        reservedFilter.emailVerificationExpiresAt = current.emailVerificationExpiresAt;
      } else {
        reservedFilter.$or = [
          { emailVerificationHash: null },
          { emailVerificationExpiresAt: { $lte: now } },
          { emailVerificationExpiresAt: null }
        ];
      }
      const reserved = await User.updateOne(reservedFilter, { $set: {
        emailVerificationHash: digest, emailVerificationExpiresAt: expiresAt
      } }, { session });
      if (reserved.matchedCount !== 1) return;

      // The token reservation and durable outbound job commit together. An ambiguous
      // provider timeout must never trigger token cleanup, otherwise a delivered link dies.
      await sqlDb.connection.collection(OUTBOX_COLLECTION).insertOne({
        _id: new sqlDb.Types.ObjectId(),
        kind: 'verification_email', userId: user._id, tokenHash: digest,
        sealedPayload, status: 'pending', attempts: 0,
        nextAttemptAt: now, lockedUntil: null,
        createdAt: now, purgeAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }, { session });
    });
  } finally {
    await session.endSession();
  }
};

const verify = async (token) => {
  if (typeof token !== 'string' || token.length !== 43) throw new ApiError(400, 'Token không hợp lệ.');
  const result = await User.updateOne({
    emailVerificationHash: hash(token), emailVerificationExpiresAt: { $gt: new Date() }, emailVerified: false, isActive: true
  }, { $set: { emailVerified: true },
    $unset: { emailVerificationHash: '', emailVerificationExpiresAt: '' } });
  if (result.matchedCount !== 1) throw new ApiError(400, 'Token hết hạn hoặc không hợp lệ.');
};
module.exports = { requestVerification, verify, OUTBOX_COLLECTION };
