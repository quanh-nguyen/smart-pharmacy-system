// Non-mutating deployment gate: fail when a pending/retry/dead_letter job has no decryptable key.
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const { unseal, inspectKeyId } = require('../utils/mailOutboxCrypto');
const checkKeys = async (collection) => {
  const groups = {};
  let total = 0;
  for await (const item of collection.find({ kind: 'verification_email',
    status: { $in: ['pending', 'retry', 'sending', 'dead_letter'] },
    sealedPayload: { $type: 'string' } },
  { projection: { sealedPayload: 1 }, batchSize: 200 })) {
    const kid = inspectKeyId(item.sealedPayload);
    unseal(item.sealedPayload); // AES-GCM authenticated decrypt, throws if key retired too early.
    groups[kid] = (groups[kid] || 0) + 1;
    total++;
  }
  return { encryptedJobs: total, keyUsage: groups };
};
const main = async () => {
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  try {
    process.stdout.write(`${JSON.stringify(await checkKeys(sqlDb.connection.collection('email_outbox')))}\n`);
  } finally { await sqlDb.disconnect(); }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Outbox key availability check failed (${error.name}).\n`);
  process.exitCode = 1;
});
module.exports = { checkKeys, main };
