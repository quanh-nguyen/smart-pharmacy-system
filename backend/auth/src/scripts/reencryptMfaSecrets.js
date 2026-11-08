// Operator-only staged encryption-key rotation. NEVER logs TOTP secrets.
// Legacy/retiring decryption keys must remain available throughout the rollout.
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const totp = require('../utils/totp');
const {
  acquireMigrationLock, assertMigrationLockOwned,
  renewMigrationLock, releaseMigrationLock
} = require('./migrationLock');

const FIELDS = ['mfaSecretEncrypted', 'mfaPendingSecretEncrypted'];
const BATCH_SIZE = 200;

const rewrap = async (collection, { dryRun = true, assertLock = async () => {} } = {}) => {
  if (!env.mfaActiveKeyId || !env.mfaEncryptionKeys?.[env.mfaActiveKeyId]) {
    throw new Error('Key rotation requires MFA_ENCRYPTION_KEYS and MFA_ACTIVE_KEY_ID.');
  }
  const prefix = `v2.${env.mfaActiveKeyId}.`;
  const cursor = collection.find({ $or: FIELDS.map((field) => ({ [field]: { $type: 'string' } })) },
    { projection: { _id: 1, mfaSecretEncrypted: 1, mfaPendingSecretEncrypted: 1 } }).batchSize(BATCH_SIZE);
  let examined = 0;
  let candidates = 0;
  let modified = 0;
  let ops = [];
  const flush = async () => {
    if (!ops.length) return;
    await assertLock();
    const result = await collection.bulkWrite(ops, { ordered: false });
    modified += result.modifiedCount || 0;
    ops = [];
  };
  try {
    for await (const user of cursor) {
      examined += 1;
      const changes = {};
      const observed = { _id: user._id };
      for (const field of FIELDS) {
        const old = user[field];
        if (typeof old !== 'string' || old.startsWith(prefix)) continue;
        candidates += 1;
        if (!dryRun) {
          // Decrypt + re-encrypt in memory only; AES-GCM is authenticated.
          const secret = totp.decrypt(old);
          changes[field] = totp.encrypt(secret);
          observed[field] = old;
        }
      }
      if (!dryRun && Object.keys(changes).length) {
        ops.push({ updateOne: { filter: observed, update: { $set: changes } } });
        if (ops.length >= BATCH_SIZE) await flush();
      }
    }
    if (!dryRun) await flush();
  } finally { await cursor.close(); }
  return { dryRun, examined, candidates, modified };
};

const main = async (argv = process.argv.slice(2)) => {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply') && argv.includes('--confirm-backup');
  if (dryRun === apply) throw new Error('Specify --dry-run OR --apply --confirm-backup.');
  if (env.nodeEnv === 'production' && (!env.mysqlMaintenanceUser || env.mysqlMaintenanceUser === env.mysqlUser)) {
    throw new Error('Production MFA rotation requires distinct migration credentials.');
  }
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  const locks = null; // MySQL GET_LOCK uses a dedicated advisory-lock connection.
  let owner;
  let heartbeat;
  try {
    if (apply) {
      owner = await acquireMigrationLock(locks);
      heartbeat = setInterval(() => {
        renewMigrationLock(locks, owner).catch(() => {}); // Each batch reasserts ownership.
      }, 60_000);
    }
    const result = await rewrap(sqlDb.connection.collection('users'), {
      dryRun, assertLock: async () => assertMigrationLockOwned(locks, owner)
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (owner) await releaseMigrationLock(locks, owner);
    await sqlDb.disconnect();
  }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`MFA rotation failed: ${error?.name || 'Error'}\n`);
  process.exitCode = 1;
});
module.exports = { rewrap, main };
