// Run as a separate worker deployment; MySQL is the durable queue.
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const logger = require('../config/logger');
const { processOne } = require('../services/emailOutboxWorker');
const { publishHeartbeat, getQueueMetrics } = require('../services/mailOutboxHealth');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
const main = async () => {
  if (!env.mailApiKey || !env.mailFrom || !(env.mailOutboxEncryptionKey || env.mailOutboxActiveKeyId)) {
    throw new Error('MAIL_API_KEY, MAIL_FROM and MAIL_OUTBOX_ENCRYPTION_KEY are required by the mail worker.');
  }
  await sqlDb.connect();
  try {
    const ready = await sqlDb.connection.collection('schema_migrations')
      .findOne({ name: '001_mysql_auth_schema' });
    if (!ready) throw new Error('Email outbox requires MySQL migration.');
    let lastHeartbeat = 0;
    let lastMetrics = 0;
    while (!stopping) {
      const now = Date.now();
      if (now - lastHeartbeat >= 5000) {
        await publishHeartbeat(new Date(now));
        lastHeartbeat = now;
      }
      if (now - lastMetrics >= 30000) {
        const metrics = await getQueueMetrics(new Date(now));
        logger.info({ event: 'mail_outbox_health', ...metrics }, 'Mail delivery queue metrics');
        if (metrics.oldestPendingSeconds > 120) {
          logger.warn({ event: 'mail_outbox_overdue', ...metrics }, 'Mail delivery SLO exceeded');
        }
        lastMetrics = now;
      }
      const worked = await processOne();
      if (!worked) await sleep(1000);
    }
  } finally {
    await sqlDb.disconnect();
  }
};
if (require.main === module) {
  process.on('SIGINT', () => { stopping = true; });
  process.on('SIGTERM', () => { stopping = true; });
  main().catch(() => {
    logger.error({ event: 'mail_worker_failed' }, 'Mail worker failed');
    process.exitCode = 1;
  });
}
module.exports = { main };
