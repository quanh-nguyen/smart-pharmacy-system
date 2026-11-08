// Memory-bounded replacement for --ids-file on large historical migrations.
// No mutation of historical migration 001/002/003 or their checksums.
const sqlDb = require('../db/mysql');
const fs = require('node:fs/promises');
const path = require('node:path');
const env = require('../config/env');
const { assertMaintenancePrincipal } = require('./maintenancePrincipal');
const { Roles } = require('../constants/roles');

const MAX_ROWS = 1_000_000;
const MAX_BYTES = 128 * 1024 * 1024;
const exportIds = async (collection, outputPath, { maxRows = MAX_ROWS, maxBytes = MAX_BYTES } = {}) => {
  const fd = await fs.open(path.resolve(outputPath), 'wx', 0o600);
  let rows = 0; let bytes = 0;
  try {
    let lastId = '';
    while (true) {
      const [batch] = await sqlDb.execute('SELECT id,payload FROM users WHERE id > ? ORDER BY id LIMIT 500', [lastId]);
      if (!batch.length) break;
      for (const row of batch) {
        lastId = row.id;
        const user = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        const scopes = [];
        if (user.role === Roles.PHARMACY && (!user.isVerified || !user.verifiedAt || !user.verifiedBy))
          scopes.push('pharmaciesToFailClosed');
        if (typeof user.isActive !== 'boolean') scopes.push('usersWithMalformedActive');
        if (!Number.isSafeInteger(user.tokenVersion) || user.tokenVersion < 0)
          scopes.push('usersWithInvalidOrMissingTokenVersion');
        for (const scope of scopes) {
          const line = JSON.stringify({ scope, id: row.id }) + '\n';
          rows++;
          bytes += Buffer.byteLength(line);
          if (rows > maxRows || bytes > maxBytes) throw new Error('Legacy ID export cap exceeded.');
          await fd.write(line);
        }
      }
    }

    await fd.sync();
    await fd.close();
    return { rows, bytes };
  } catch (error) {
    await fd.close().catch(() => {});
    await fs.unlink(path.resolve(outputPath)).catch(() => {});
    throw error;
  }
};
const main = async () => {
  const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
  if (!output) throw new Error('Required: --output=<new-private-jsonl-file>.');
  assertMaintenancePrincipal();
  if (env.mysqlMaintenanceUser) sqlDb.useMaintenancePrincipal();
  await sqlDb.connect();
  try {
    const report = await exportIds(sqlDb.connection.collection('users'), output);
    process.stdout.write(`Private export completed: ${report.rows} rows.\n`);
  } finally { await sqlDb.disconnect(); }
};
if (require.main === module) main().catch((error) => {
  process.stderr.write(`Legacy ID export failed (${error.name}).\n`);
  process.exitCode = 1;
});
module.exports = { exportIds, main };
