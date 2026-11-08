// Controlled key rollover for in-flight email outbox jobs. Requires migration DB principal.
// Review a backup and dry-run before --apply --confirm-backup.
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const { seal, unseal, inspectKeyId } = require('../utils/mailOutboxCrypto');

const COLLECTION = 'email_outbox';
const rewrap = async (collection, { apply = false, now = new Date() } = {}) => {
  if (!env.mailOutboxActiveKeyId) {
    throw new Error('MAIL_OUTBOX_ACTIVE_KEY_ID and MAIL_OUTBOX_ENCRYPTION_KEYS are required.');
  }
  const report = { inspected: 0, alreadyCurrent: 0, rewrapped: 0, skippedInFlight: 0 };
  const cursor = collection.find({ kind: 'verification_email',
    status: { $in: ['pending', 'retry', 'sending', 'dead_letter'] },
    sealedPayload: { $type: 'string' } },
  { projection: { _id: 1, status: 1, lockedUntil: 1, sealedPayload: 1 }, batchSize: 200 });
  for await (const job of cursor) {
    report.inspected++;
    if (inspectKeyId(job.sealedPayload) === env.mailOutboxActiveKeyId) {
      report.alreadyCurrent++;
      continue;
    }
    // Explicitly prove that the old/retired key is present BEFORE writing a new envelope.
    const plaintext = unseal(job.sealedPayload);
    if (job.status === 'sending' && job.lockedUntil > now) {
      report.skippedInFlight++;
      continue;
    }
    if (!apply) { report.rewrapped++; continue; }
    const replaced = await collection.updateOne({ _id: job._id,
      sealedPayload: job.sealedPayload,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { sealedPayload: seal(plaintext) } });
    report.rewrapped += replaced.modifiedCount;
  }
  return report;
};
const main = async (args = process.argv.slice(2)) => {
  const apply = args.includes('--apply');
  if (apply && !args.includes('--confirm-backup')) throw new Error('Backup confirmation required.');
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  try {
    const report = await rewrap(sqlDb.connection.collection(COLLECTION), { apply });
    process.stdout.write(`${JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...report })}\n`);
  } finally { await sqlDb.disconnect(); }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Outbox rewrap failed (${error.name}).\n`);
  process.exitCode = 1;
});
module.exports = { rewrap, main };
