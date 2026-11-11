// Optional *pre-006* data preflight: batch backfill without changing checksum of
// migration 006 already released. Requires migration credentials, a tested backup,
// and exclusive migration lease; leaves active refresh tokens usable.
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const {
  acquireMigrationLock, assertMigrationLockOwned,
  renewMigrationLock, releaseMigrationLock
} = require('./migrationLock');

const BATCH_SIZE = 500;
const LEASE_MS = 5 * 60 * 1000;
const backfill = async (collection, { assertLock, dryRun = true, batchSize = BATCH_SIZE } = {}) => {
  const now = new Date();
  const query = { state: { $exists: false }, expiresAt: { $gt: now } };
  if (dryRun) return { mode: 'dry-run', candidates: await collection.countDocuments(query) };
  const cursor = collection.find(query, {
    projection: { _id: 1, expiresAt: 1, createdAt: 1 }
  }).batchSize(batchSize);
  let operations = [];
  let examined = 0;
  let modified = 0;
  const flush = async () => {
    if (operations.length === 0) return;
    await assertLock();
    const result = await collection.bulkWrite(operations, { ordered: false });
    modified += result.modifiedCount || 0;
    operations = [];
  };
  try {
    for await (const item of cursor) {
      examined += 1;
      const absolute = new Date(Math.max(item.expiresAt.getTime(),
        (item.createdAt || now).getTime() + 30 * 24 * 60 * 60 * 1000));
      operations.push({ updateOne: {
        filter: { _id: item._id, state: { $exists: false } },
        update: { $set: {
          familyId: new sqlDb.Types.ObjectId(), state: 'active',
          validUntil: item.expiresAt,
          expiresAt: absolute, absoluteExpiresAt: absolute
        } }
      } });
      if (operations.length >= batchSize) await flush();
    }
    await flush();
  } finally {
    await cursor.close();
  }
  return { mode: 'applied', examined, modified, batchSize };
};

const main = async (argv = process.argv.slice(2)) => {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply') && argv.includes('--confirm-backup');
  if (dryRun === apply) throw new Error('Use --dry-run OR --apply --confirm-backup.');
  if (env.nodeEnv === 'production' && (!env.mysqlMaintenanceUser || env.mysqlMaintenanceUser === env.mysqlUser)) {
    throw new Error('Production preflight requires separate MYSQL_MAINTENANCE_USER.');
  }
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  const locks = null; // MySQL GET_LOCK uses a dedicated advisory-lock connection.
  let owner;
  let heartbeat;
  try {
    if (apply) {
      owner = await acquireMigrationLock(locks, { leaseMs: LEASE_MS });
      heartbeat = setInterval(() => {
        renewMigrationLock(locks, owner, LEASE_MS).catch(() => {
          // The next batch asserts ownership and stops; never silently bypass lock loss.
        });
      }, 60_000);
    }
    const result = await backfill(sqlDb.connection.collection('refresh_sessions'), {
      dryRun,
      assertLock: async () => assertMigrationLockOwned(locks, owner)
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (owner) await releaseMigrationLock(locks, owner);
    await sqlDb.disconnect();
  }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Refresh backfill failed: ${error?.name || 'Error'}\n`);
  process.exitCode = 1;
});
module.exports = { backfill, main };
