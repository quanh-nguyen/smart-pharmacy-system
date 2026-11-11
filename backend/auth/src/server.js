// Validate configuration before loading application modules.
const env = require('./config/env');
const http = require('node:http');
const sqlDb = require('./db/mysql');
const connectDB = require('./config/db');
const connectRedis = require('./config/redis');
const logger = require('./config/logger');
const lifecycle = require('./config/lifecycle');
const { toLoggableError } = require('./utils/toLoggableError');
const { createApp } = require('./app');
const { getDummyHash } = require('./utils/password');

let server;
let redisClient;
let shuttingDown = false;
const closeServer = (httpServer) => new Promise((resolve) => {
  if (!httpServer || !httpServer.listening) return resolve();
  httpServer.close((error) => resolve(error));
});

const shutdown = async (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  lifecycle.shuttingDown = true;
  logger.info({ reason }, 'Graceful shutdown started');
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();
  try {
    const closeError = await closeServer(server);
    if (closeError) logger.error({ err: toLoggableError(closeError) }, 'HTTP server close failed');
    if (redisClient) await redisClient.quit().catch(() => redisClient.disconnect());
    await sqlDb.disconnect();
    process.exitCode = exitCode;
    logger.info('Shutdown completed');
  } catch (error) {
    logger.error({ err: toLoggableError(error) }, 'Shutdown failed');
    process.exitCode = 1;
  } finally { clearTimeout(forceExitTimer); }
};

const start = async () => {
  await getDummyHash();
  if (shuttingDown) return;
  await connectDB();
  if (shuttingDown) return;
  redisClient = await connectRedis();
  if (shuttingDown) {
    if (redisClient) await redisClient.quit().catch(() => redisClient.disconnect());
    return;
  }
  server = http.createServer(createApp({ redisClient }));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;
  server.on('error', (error) => {
    logger.error({ err: toLoggableError(error) }, 'HTTP server failed');
    void shutdown('http-server-error', 1);
  });
  if (shuttingDown) return;
  server.listen(env.port, () => logger.info({ port: env.port, environment: env.nodeEnv }, 'HTTP server listening'));
};

if (require.main === module) {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: toLoggableError(reason) }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: toLoggableError(error) }, 'Uncaught exception');
    process.exit(1);
  });
  start().catch((error) => {
    logger.fatal({ err: toLoggableError(error) }, 'Application startup failed');
    void shutdown('startup-failed', 1);
  });
}
module.exports = { start, shutdown };
