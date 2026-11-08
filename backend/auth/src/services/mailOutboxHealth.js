const sqlDb = require('../db/mysql');
const env = require('../config/env');

const HEARTBEAT_ID = 'mail-worker-primary';
const COLLECTION = 'email_outbox';
const DEFAULT_MAX_AGE_MS = 20_000;
const store = () => sqlDb.connection.collection(COLLECTION);
const isConfigured = () => Boolean(env.mailApiKey && env.mailFrom && env.mailOutboxEncryptionKey ||
  env.mailApiKey && env.mailFrom && env.mailOutboxActiveKeyId);

const publishHeartbeat = async (now = new Date()) => {
  await store().updateOne({ _id: HEARTBEAT_ID }, {
    $set: { kind: 'worker_heartbeat', checkedAt: now },
    $setOnInsert: { createdAt: now }
  }, { upsert: true });
};
const getHealth = async ({ now = new Date(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) => {
  if (!isConfigured()) return { configured: false, healthy: true };
  const heartbeat = await store().findOne({ _id: HEARTBEAT_ID, kind: 'worker_heartbeat' },
    { projection: { checkedAt: 1 } });
  return { configured: true, healthy: Boolean(heartbeat?.checkedAt &&
    now.getTime() - new Date(heartbeat.checkedAt).getTime() <= maxAgeMs) };
};
const getQueueMetrics = async (now = new Date()) => {
  const status = { $in: ['pending', 'retry', 'sending'] };
  const [pending, oldest, deadLetter] = await Promise.all([
    store().countDocuments({ kind: 'verification_email', status }),
    store().findOne({ kind: 'verification_email', status },
      { sort: { createdAt: 1 }, projection: { createdAt: 1 } }),
    store().countDocuments({ kind: 'verification_email', status: 'dead_letter' })
  ]);
  return { pending, deadLetter, oldestPendingSeconds: oldest?.createdAt ?
    Math.max(0, Math.floor((now.getTime() - new Date(oldest.createdAt).getTime()) / 1000)) : 0 };
};
module.exports = { HEARTBEAT_ID, isConfigured, publishHeartbeat, getHealth, getQueueMetrics };
