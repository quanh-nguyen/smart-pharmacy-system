const Redis = require('ioredis');
const env = require('./env');
const logger = require('./logger');
const { toLoggableError } = require('../utils/toLoggableError');

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 250;

const retryStrategy = (attempt) => {
  // Capped exponential backoff with jitter; continue retrying so a recovered Redis can restore readiness.
  const exponent = Math.min(Math.max(attempt - 1, 0), 7);
  const cappedDelay = Math.min(BASE_RECONNECT_DELAY_MS * (2 ** exponent), MAX_RECONNECT_DELAY_MS);
  const delayMs = Math.max(100, Math.floor(cappedDelay * (0.5 + Math.random())));
  logger.warn({ attempt, delayMs }, 'Redis reconnect scheduled');
  return delayMs;
};

const withTimeout = (promise, timeoutMs, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
};

const connectRedis = async () => {
  if (!env.redisUrl) {
    logger.warn('REDIS_URL is not configured; rate limiting is process-local and is not shared across instances');
    return null;
  }

  const client = new Redis(env.redisUrl, {
    lazyConnect: true,
    connectTimeout: env.redisConnectTimeoutMs,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    retryStrategy
  });

  client.on('error', (error) => {
    logger.error({ err: toLoggableError(error) }, 'Redis connection error; configured Redis remains a required dependency');
  });

  client.on('ready', () => logger.info('Redis connection ready'));
  client.on('reconnecting', (delayMs) => logger.warn({ delayMs }, 'Redis reconnecting'));
  client.on('end', () => logger.error('Redis connection ended; readiness will remain false until reconnect succeeds'));

  try {
    await withTimeout(client.connect(), env.redisConnectTimeoutMs, 'Redis initial connection timed out.');
    await withTimeout(client.ping(), env.redisConnectTimeoutMs, 'Redis startup ping timed out.');
    logger.info('Redis connected; distributed rate limiting enabled');
    return client;
  } catch (error) {
    // Do not leave a retrying client behind if startup fails; runtime reconnect is handled after successful startup.
    try {
      client.disconnect();
    } catch (cleanupError) {
      logger.error({ err: toLoggableError(cleanupError) }, 'Redis cleanup after startup failure failed');
    }
    throw error;
  }
};

module.exports = connectRedis;
module.exports.retryStrategy = retryStrategy;
