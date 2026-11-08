const express = require('express');
const sqlDb = require('../db/mysql');
const env = require('../config/env');
const lifecycle = require('../config/lifecycle');
const { getHealth, isConfigured } = require('../services/mailOutboxHealth');

const createHealthRoutes = ({ redisClient = null } = {}) => {
  const router = express.Router();

  router.get('/', (_req, res) => {
    return res.status(200).json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString()
    });
  });

  router.get('/ready', async (_req, res) => {
    const mysqlReady = await sqlDb.connect().then(() => true).catch(() => false);
    const redisConfigured = Boolean(env.redisUrl);
    const redisReady = !redisConfigured || redisClient?.status === 'ready';
    // Core readiness does not wait for the mail worker or its heartbeat DB query.
    const ready = mysqlReady && redisReady && !lifecycle.shuttingDown;

    return res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'not_ready',
      dependencies: {
        mysql: mysqlReady ? 'connected' : 'disconnected',
        mailDelivery: isConfigured() ? 'separate_probe' : 'disabled',
        rateLimitStore: redisConfigured
          ? (redisReady ? 'redis_connected' : 'redis_disconnected')
          : 'memory_process_local'
      }
    });
  });

  // Separate component probe for the mail worker. A failing mail worker must not
  // remove otherwise-healthy authentication API instances from a load balancer.
  router.get('/mail', async (_req, res) => {
    if (!isConfigured()) return res.status(200).json({ status: 'disabled' });
    try {
      const mail = await getHealth();
      return res.status(mail.healthy ? 200 : 503).json({
        status: mail.healthy ? 'worker_ready' : 'worker_not_ready'
      });
    } catch {
      return res.status(503).json({ status: 'worker_not_ready' });
    }
  });

  return router;
};

module.exports = createHealthRoutes;
