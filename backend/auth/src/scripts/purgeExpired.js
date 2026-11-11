'use strict';
// MySQL has no MongoDB-style TTL indexes. Run this on a schedule, e.g. daily.
const db = require('../db/mysql');
const logger = require('../config/logger');
const purge = async (now = new Date()) => {
  const iso = now.toISOString();
  const [refresh] = await db.execute('DELETE FROM refresh_sessions WHERE expires_at IS NOT NULL AND expires_at < ?', [iso]);
  const [outbox] = await db.execute('DELETE FROM email_outbox WHERE purge_at IS NOT NULL AND purge_at < ?', [iso]);
  const [operations] = await db.execute('DELETE FROM security_operations WHERE expires_at IS NOT NULL AND expires_at < ?', [iso]);
  return { refreshSessions: refresh.affectedRows, outboxJobs: outbox.affectedRows,
    securityOperations: operations.affectedRows };
};
if (require.main === module) purge().then((counts) => logger.info(counts,'Expired MySQL records purged'))
  .catch((err) => { logger.error({ err: err.name }, 'Purge failed'); process.exitCode = 1; })
  .finally(() => db.disconnect());
module.exports = { purge };
