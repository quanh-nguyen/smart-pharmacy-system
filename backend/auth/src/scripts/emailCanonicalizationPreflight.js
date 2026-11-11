// Memory-bounded read-only preflight for large collections; DOES NOT mutate historical migration 003.
const sqlDb = require('../db/mysql');
const crypto = require('node:crypto');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const { emailSchema } = require('../validation/commonSchemas');
const canonicalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : value;

const collectBoundedReport = async (collection, { samples = 10 } = {}) => {
  let totalUsers = 0;
  let missingEmailCount = 0;
  let invalidEmailCount = 0;
  let nonCanonicalEmailCount = 0;
  const sampleIds = { missingEmail: [], invalidEmail: [], nonCanonicalEmail: [] };

  for await (const user of collection.find({}, { projection: { _id: 1, email: 1 } }).batchSize(500)) {
    totalUsers += 1;
    const normalized = canonicalizeEmail(user.email);
    const missing = user.email == null || user.email === '' ||
      (typeof user.email === 'string' && !user.email.trim());
    const invalid = !missing && !emailSchema.safeParse(normalized).success;
    const noncanonical = !missing && !invalid && user.email !== normalized;
    if (missing) missingEmailCount += 1;
    if (invalid) invalidEmailCount += 1;
    if (noncanonical) nonCanonicalEmailCount += 1;
    const id = user._id.toString();
    if (missing && sampleIds.missingEmail.length < samples) sampleIds.missingEmail.push(id);
    if (invalid && sampleIds.invalidEmail.length < samples) sampleIds.invalidEmail.push(id);
    if (noncanonical && sampleIds.nonCanonicalEmail.length < samples) sampleIds.nonCanonicalEmail.push(id);
  }

  let canonicalEmailCollisionGroupCount = 0;
  let canonicalEmailCollisionDocumentCount = 0;
  const canonicalCollisionSamples = [];
  // Server-side MySQL grouping replaces MongoDB aggregation and remains bounded.
  const [collisionRows] = await sqlDb.execute(`SELECT LOWER(TRIM(email)) AS normalized_email,
    COUNT(*) AS duplicates FROM users WHERE email IS NOT NULL
    GROUP BY LOWER(TRIM(email)) HAVING COUNT(*) > 1`);
  for (const row of collisionRows) {
    const canonicalEmail = row.normalized_email;
    const size = Number(row.duplicates);
    if (!emailSchema.safeParse(canonicalEmail).success) continue;
    canonicalEmailCollisionGroupCount++;
    canonicalEmailCollisionDocumentCount += size;
    if (canonicalCollisionSamples.length < samples) {
      canonicalCollisionSamples.push({
        canonicalEmailSha256: crypto.createHash('sha256').update(canonicalEmail).digest('hex'),
        count: size
      });
    }
  }

  return { totalUsers, missingEmailCount, invalidEmailCount, nonCanonicalEmailCount,
    canonicalEmailCollisionGroupCount, canonicalEmailCollisionDocumentCount,
    readyToApply: missingEmailCount === 0 && invalidEmailCount === 0 &&
      canonicalEmailCollisionGroupCount === 0,
    sampleIds, canonicalCollisionSamples, sampleLimit: samples };
};

const main = async () => {
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  try {
    const report = await collectBoundedReport(sqlDb.connection.collection('users'));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await sqlDb.disconnect(); }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Read-only preflight failed (${error?.name || 'Error'}).\n`);
  process.exitCode = 1;
});
module.exports = { collectBoundedReport, main };
