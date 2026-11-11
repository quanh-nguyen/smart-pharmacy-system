const crypto = require('node:crypto');
const sqlDb = require('../db/mysql');
const User = require('../models/User');
const env = require('../config/env');
const logger = require('../config/logger');
const { unseal } = require('../utils/mailOutboxCrypto');
const { OUTBOX_COLLECTION } = require('./emailVerificationService');

const { MAX_BACKOFF_MS, classifyDelivery, parseRetryAfter, computeRetryDelay } =
  require('../utils/emailDeliveryPolicy');
const CLAIM_MS = 45_000;
const MAX_ATTEMPTS = 8;
const workerId = crypto.randomBytes(12).toString('hex');
const store = () => sqlDb.connection.collection(OUTBOX_COLLECTION);

const processOne = async ({ send = fetch, now = new Date(), random = Math.random } = {}) => {
  // Every individual claim needs a unique fencing token, even in one worker process.
  const leaseId = crypto.randomUUID();
  const job = await store().findOneAndUpdate({
    kind: 'verification_email', status: { $in: ['pending', 'retry', 'sending'] },
    nextAttemptAt: { $lte: now },
    $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }]
  }, { $set: { status: 'sending', workerId, leaseId, lockedUntil: new Date(now.getTime() + CLAIM_MS) } },
  { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: 'after' });
  if (!job) return false;

  const claim = { _id: job._id, workerId, leaseId, status: 'sending' };
  const complete = async (status, fields = {}) => {
    const result = await store().updateOne(claim, {
      $set: { status, lockedUntil: null, ...fields },
      $unset: { workerId: '', leaseId: '', ...(status === 'sent' ? { sealedPayload: '' } : {}) }
    });
    if (result.matchedCount !== 1) {
      throw new Error('Mail delivery lease no longer owned by this worker.');
    }
  };
  try {
    const owner = await User.findOne({
      _id: job.userId, isActive: true, emailVerified: false,
      emailVerificationHash: job.tokenHash, emailVerificationExpiresAt: { $gt: new Date() }
    }).select('_id emailVerificationExpiresAt').lean();
    if (!owner) {
      await complete('obsolete', { purgeAt: new Date(now.getTime() + 24 * 3600_000) });
      return true;
    }

    const { to, link } = unseal(job.sealedPayload);
    // A successful provider response and a failed SQL acknowledgement are
    // different outcomes. Never record a provider-success as a delivery failure.
    let decision;
    try {
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.mailApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `smartmedicine-email-${job._id}`
        },
        body: JSON.stringify({ from: env.mailFrom, to: [to],
          subject: 'Xác minh email Smart Medicine',
          text: `Vui lòng xác minh email trong vòng 15 phút: ${link}` }),
        signal: AbortSignal.timeout(5000)
      });
      decision = classifyDelivery(response);
    } catch (networkError) {
      // A timeout can mean accepted-but-response-lost; preserve the same
      // idempotency key for retry and never invalidate the token.
      const transient = new Error('Mail provider result unknown');
      transient.retryAfter = networkError?.retryAfter;
      throw transient;
    }

    if (decision.kind === 'sent') {
      try {
        await complete('sent', { sentAt: new Date(), deliveryStatus: 'confirmed',
          purgeAt: new Date(now.getTime() + 24 * 3600_000) });
      } catch (commitError) {
        // The provider already accepted this message. The lease will eventually
        // expire if persistence is unavailable; the provider must honor the
        // stable Idempotency-Key on retry. This is at-least-once, not exactly-once.
        logger.error({ event: 'mail_delivery_commit_unknown', jobId: String(job._id),
          errorName: commitError?.name }, 'Provider accepted mail but DB acknowledgement failed');
        // Skip the transient-delivery catch; the worker supervisor observes this.
        commitError.mailCommitUnknown = true;
        throw commitError;
      }
      return true;
    }
    if (decision.kind === 'dead_letter') {
      await complete('dead_letter', { deliveryStatus: 'permanent_failure',
        deadLetterReason: decision.reason, attempts: (job.attempts || 0) + 1,
        purgeAt: new Date(now.getTime() + 7 * 24 * 3600_000) });
      logger.error({ event: 'mail_delivery_dead_letter', jobId: String(job._id) },
        'Mail provider returned a permanent error');
      return true;
    }
    const failed = new Error('Transient mail delivery failure');
    failed.retryAfter = decision.retryAfter;
    throw failed;
  } catch (error) {
    if (error.mailCommitUnknown) throw error;
    // A provider may have accepted an email before a timeout. Never invalidate
    // the reserved token on an ambiguous outcome or log its encrypted payload.
    const attempt = (job.attempts || 0) + 1;
    const delay = computeRetryDelay({ attempt, retryAfter: error.retryAfter,
      now: now.getTime(), random });
    const deadline = new Date(job.createdAt).getTime() + 15 * 60_000;
    if (attempt >= MAX_ATTEMPTS || now.getTime() + delay >= deadline) {
      await complete('dead_letter', { attempts: attempt, deliveryStatus: 'unknown',
        deadLetterReason: 'RETRY_BUDGET_EXHAUSTED',
        purgeAt: new Date(now.getTime() + 7 * 24 * 3600_000) });
      logger.warn({ event: 'mail_delivery_dead_letter', attempt, jobId: String(job._id) },
        'Mail delivery exhausted its retry budget');
    } else {
      await complete('retry', { attempts: attempt, deliveryStatus: 'unknown',
        nextAttemptAt: new Date(now.getTime() + delay) });
      logger.warn({ event: 'mail_delivery_retry', attempt, jobId: String(job._id) },
        'Email delivery not yet confirmed');
    }
  }
  return true;
};
module.exports = { processOne, classifyDelivery, parseRetryAfter, computeRetryDelay,
  MAX_ATTEMPTS, MAX_BACKOFF_MS };
