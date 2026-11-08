require('./bootstrap');
const http = require('node:http');
const { createApp } = require('./app');
const db = require('../auth/src/db/mysql');
const { pool } = require('../catalog/src/config/db');
const { sequelize } = require('../operations/src/models');
const lifecycle = require('../auth/src/config/lifecycle');
let server, io, redisClient, shuttingDown = false;

async function start() {
  await require('../auth/src/config/db')();
  await pool.query('SELECT id FROM medicines LIMIT 1');
  await sequelize.authenticate();
  await sequelize.query('SELECT id FROM orders LIMIT 1');
  redisClient = await require('../auth/src/config/redis')();
  await require('../auth/src/utils/password').getDummyHash();
  server = http.createServer(createApp({ redisClient }));
  io = require('../operations/src/modules/notifications/socket').initSocket(server);
  require('../operations/src/modules/notifications/notification.listeners').registerOrderListeners();
  await require('../operations/src/modules/prescriptions/prescription.service').recoverStuckJobs();
  server.keepAliveTimeout = 65000; server.headersTimeout = 66000; server.requestTimeout = 30000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', resolve);
  });
  console.log(`Smart Pharmacy web + API listening on port ${server.address().port}`);
  return server;
}
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; lifecycle.shuttingDown = true;
  const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
  if (io) await new Promise(resolve => io.close(resolve));
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (redisClient) await redisClient.quit().catch(() => redisClient.disconnect());
  await Promise.allSettled([db.disconnect(), pool.end(), sequelize.close()]);
  clearTimeout(timer);
}
if (require.main === module) {
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void shutdown());
  start().catch(async error => {
    console.error(`Startup failed: ${error.message}. Run npm run migrate in backend/.`);
    process.exitCode = 1; await shutdown();
  });
}
module.exports = { start, shutdown };
