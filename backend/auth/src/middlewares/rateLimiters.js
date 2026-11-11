const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const crypto = require('node:crypto');
const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

// Failure count, capped source set, block TTL and generation checks are one atomic transition.
const FAILURE_TRACKING_LUA = `
  local currentEpoch = tonumber(redis.call('GET', KEYS[4]) or '0')
  if currentEpoch ~= tonumber(ARGV[10]) then return {-1, redis.call('SCARD', KEYS[2]), redis.call('TTL', KEYS[3]), 0} end

  local count = redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])

  local sourceAdded = 0
  if redis.call('SISMEMBER', KEYS[2], ARGV[2]) == 0 then
    local currentSources = redis.call('SCARD', KEYS[2])
    if currentSources < tonumber(ARGV[3]) then
      redis.call('SADD', KEYS[2], ARGV[2])
      sourceAdded = 1
    end
  end
  redis.call('EXPIRE', KEYS[2], ARGV[1])
  local sourceCount = redis.call('SCARD', KEYS[2])
  local capped = 0
  if sourceAdded == 0 and redis.call('SISMEMBER', KEYS[2], ARGV[2]) == 0 and sourceCount >= tonumber(ARGV[3]) then
    if redis.call('SET', KEYS[5], '1', 'NX', 'EX', ARGV[1]) then capped = 1 end
  end

  local requestedBlock = 0
  if count >= tonumber(ARGV[4]) and sourceCount >= tonumber(ARGV[5]) then requestedBlock = 60 end
  if count >= tonumber(ARGV[6]) and sourceCount >= tonumber(ARGV[7]) then requestedBlock = 300 end
  if count >= tonumber(ARGV[8]) and sourceCount >= tonumber(ARGV[9]) then requestedBlock = 900 end

  local currentBlockTtl = redis.call('TTL', KEYS[3])
  if requestedBlock > 0 and requestedBlock > currentBlockTtl then
    redis.call('SET', KEYS[3], '1', 'EX', requestedBlock)
    currentBlockTtl = requestedBlock
    -- Re-arm thresholds only after a NEW full failure window; prevent one-IP block renewal.
    redis.call('DEL', KEYS[1], KEYS[2])
    -- invalidate callbacks captured before the block (same epoch protection as login success).
    redis.call('SET', KEYS[4], currentEpoch + 1, 'EX', ARGV[1])
  end
  return {count, sourceCount, currentBlockTtl, capped}
`;

const LOGIN_STATE_LUA = `
  return {redis.call('EXISTS', KEYS[1]), tonumber(redis.call('GET', KEYS[2]) or '0')}
`;

const RESET_LOGIN_STATE_LUA = `
  local currentEpoch = tonumber(redis.call('GET', KEYS[4]) or '0')
  redis.call('SET', KEYS[4], currentEpoch + 1, 'EX', ARGV[1])
  return redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[5])
`;

const normalizeIdentity = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return '<invalid-email>';
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '<invalid-email>';
};

const hmac = (value) => crypto.createHmac('sha256', env.authRateLimitHmacSecret).update(value).digest('hex');
const identityDigest = (value) => hmac(normalizeIdentity(value));
const sourceDigest = (ip) => hmac(`ip:${ipKeyGenerator(String(ip || 'unknown'))}`);
const identityPairKey = (ip, email) => `${ipKeyGenerator(ip)}:${identityDigest(email)}`;

const createStore = (redisClient, prefix) => !redisClient ? undefined : new RedisStore({
  prefix,
  sendCommand: async (command, ...args) => {
    try { return await redisClient.call(command, ...args); }
    catch (error) { throw redisUnavailable(error); }
  }
});

const redisUnavailable = (error) => {
  const unavailable = new ApiError(503, 'Dịch vụ tạm thời không khả dụng.', undefined, 'RATE_LIMIT_STORE_UNAVAILABLE');
  unavailable.dependencyName = 'redis';
  unavailable.cause = error;
  return unavailable;
};
const rateLimitResponse = (req, res, next) => {
  const resetTime = req.rateLimit?.resetTime;
  const retryAfter = resetTime instanceof Date ? Math.max(1,
    Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60;
  res.set('Retry-After', String(retryAfter));
  return next(new ApiError(429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
    undefined, 'RATE_LIMITED'));
};

const registerCommands = (redisClient) => {
  if (typeof redisClient?.defineCommand !== 'function' || redisClient.__authCommandsRegistered) return;
  redisClient.defineCommand('authTrackFailure', { numberOfKeys: 5, lua: FAILURE_TRACKING_LUA });
  redisClient.defineCommand('authLoginState', { numberOfKeys: 2, lua: LOGIN_STATE_LUA });
  redisClient.defineCommand('authResetState', { numberOfKeys: 5, lua: RESET_LOGIN_STATE_LUA });
  redisClient.__authCommandsRegistered = true;
};

const runScript = (redisClient, name, script, count, ...args) =>
  typeof redisClient[name] === 'function'
    ? redisClient[name](...args)
    : redisClient.eval(script, count, ...args);

const getGlobalBlockSeconds = (failureCount, distinctSourceCount) => {
  if (failureCount >= env.authRateLimitGlobalBlockThirdLevelFailures && distinctSourceCount >= env.authRateLimitGlobalBlockThirdLevelIps) return 900;
  if (failureCount >= env.authRateLimitGlobalBlockSecondLevelFailures && distinctSourceCount >= env.authRateLimitGlobalBlockSecondLevelIps) return 300;
  if (failureCount >= env.authRateLimitGlobalBlockMinFailures && distinctSourceCount >= env.authRateLimitGlobalBlockMinIps) return 60;
  return 0;
};

const trackFailureAtomically = async (redisClient, {
  failuresKey, sourcesKey, blockedKey, epochKey, capAlertKey, sourceKey, ttlSeconds,
  requestEpoch = 0
}) => {
  const result = await runScript(redisClient, 'authTrackFailure', FAILURE_TRACKING_LUA, 5,
    failuresKey,
    sourcesKey,
    blockedKey,
    epochKey,
    capAlertKey,
    ttlSeconds,
    sourceKey,
    env.authRateLimitGlobalBlockThirdLevelIps,
    env.authRateLimitGlobalBlockMinFailures,
    env.authRateLimitGlobalBlockMinIps,
    env.authRateLimitGlobalBlockSecondLevelFailures,
    env.authRateLimitGlobalBlockSecondLevelIps,
    env.authRateLimitGlobalBlockThirdLevelFailures,
    env.authRateLimitGlobalBlockThirdLevelIps,
    requestEpoch
  );
  if (!Array.isArray(result) || result.length !== 4) throw new Error('Redis login failure tracker returned an invalid result.');
  const [failureCount, distinctSourceCount, blockTtl, capped] = result.map(Number);
  return { failureCount, distinctSourceCount, blockTtl, capped: capped === 1, stale: failureCount < 0 };
};

const createLoginFailureGuard = (redisClient = null) => async (req, res, next) => {
  if (!redisClient) return next();

  const digest = identityDigest(req.body?.email);
  const keyBase = `auth:login:{${digest}}`;
  const failuresKey = `${keyBase}:failures`;
  const sourcesKey = `${keyBase}:sources`;
  const blockedKey = `${keyBase}:blocked`;
  const epochKey = `${keyBase}:epoch`;
  const capAlertKey = `${keyBase}:source-cap-alert`;
  const trustedKey = `${keyBase}:trusted`;
  const sourceKey = sourceDigest(req.ip);
  let requestEpoch;

  try {
    const state = await runScript(redisClient, 'authLoginState', LOGIN_STATE_LUA, 2, blockedKey, epochKey);
    if (!Array.isArray(state) || state.length !== 2) throw new Error('Redis login state returned an invalid result.');
    if (Number(state[0]) === 1 && !(await redisClient.sismember(trustedKey, sourceKey))) {
      const retryAfter = Math.max(1, Number(await redisClient.ttl(blockedKey)) || 60);
      res.set('Retry-After', String(retryAfter));
      return next(new ApiError(429, 'Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau.')); 
    }
    requestEpoch = Number(state[1]);
  } catch (error) {
    return next(redisUnavailable(error)); // Fail closed as 503, not 500.
  }

  // Auth controller awaits these transitions before writing the response. This avoids
  // losing failures on process shutdown between res.finish and the Redis write.
  req.recordLoginFailure = async () => {
    try {
      const { failureCount, distinctSourceCount, blockTtl, capped, stale } = await trackFailureAtomically(redisClient, {
        failuresKey, sourcesKey, blockedKey, epochKey, capAlertKey,
        sourceKey, ttlSeconds: env.authRateLimitFailureWindowSeconds, requestEpoch
      });
      if (stale) return;
      if (capped) logger.warn({ requestId: req.id }, 'Login failure source cardinality cap reached');
      if (blockTtl > 0) {
        logger.warn({ requestId: req.id, failureCount, distinctSourceCount, blockSeconds: blockTtl },
          'Distributed login-abuse threshold reached');
      }
    } catch (error) { throw redisUnavailable(error); }
  };
  req.recordLoginSuccess = async () => {
    try {
      await runScript(redisClient, 'authResetState', RESET_LOGIN_STATE_LUA, 5,
        failuresKey, sourcesKey, blockedKey, epochKey, capAlertKey, 7 * 24 * 60 * 60);
      await redisClient.sadd(trustedKey, sourceKey);
      await redisClient.expire(trustedKey, 30 * 24 * 60 * 60);
    } catch (error) { throw redisUnavailable(error); }
  };

  return next();
};

const createAuthRateLimiters = (redisClient = null) => {
  registerCommands(redisClient);
  const common = {
    windowMs: env.authRateLimitWindowMs,
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitResponse,
    passOnStoreError: false
  };

  const build = (prefix, limit, keyGenerator, skipSuccessfulRequests = false) => rateLimit({
    ...common,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    store: createStore(redisClient, prefix)
  });
  return {
    // Per-operation counters; aliases of the same operation share the same budget.
    registerIpLimiter: build('rl:register:ip:', env.authRateLimitIpMax, (req) => ipKeyGenerator(req.ip)),
    registerIdentityLimiter: build('rl:register:identity:', env.authRateLimitIdentityMax,
      (req) => identityPairKey(req.ip, req.body?.email)),
    loginIpLimiter: build('rl:login:ip:', env.authRateLimitIpMax,
      (req) => ipKeyGenerator(req.ip), true),
    loginIdentityLimiter: build('rl:login:identity:', env.authRateLimitIdentityMax,
      (req) => identityPairKey(req.ip, req.body?.email), true),
    apiLimiter: build('rl:api:ip:', 500, (req) => ipKeyGenerator(req.ip)),
    // Shared across /api/auth and /api/v1/auth aliases; both run before bcrypt.
    changePwdByUser: build('rl:password:user:', 5,
      (req) => hmac(`change-password:${req.user?.id}`)),
    changePwdByUserIp: build('rl:password:user-ip:', 10,
      (req) => hmac(`change-password:${req.user?.id}:${ipKeyGenerator(req.ip)}`)),
    // Separate budgets per behavior, without storing raw email/refresh tokens in Redis keys.
    refreshBySession: build('rl:refresh:session:', 20,
      (req) => hmac(`refresh:${String(req.body?.refreshToken || '').slice(0, 24)}`)),
    refreshByIp: build('rl:refresh:ip:', 60, (req) => ipKeyGenerator(req.ip)),
    emailSendCooldown: rateLimit({ ...common, windowMs: 60 * 1000, limit: 1,
      keyGenerator: (req) => hmac(`mail:${req.user?.id}`),
      store: createStore(redisClient, 'rl:email:cooldown:') }),
    emailSendDaily: rateLimit({ ...common, windowMs: 24 * 60 * 60 * 1000, limit: 8,
      keyGenerator: (req) => hmac(`mail:${req.user?.id}`),
      store: createStore(redisClient, 'rl:email:daily:') }),
    mfaConfirmByUser: rateLimit({ ...common, windowMs: 5 * 60 * 1000, limit: 5,
      keyGenerator: (req) => hmac(`mfa:${req.user?.id}`),
      store: createStore(redisClient, 'rl:mfa:confirm:') }),
    mfaSetupByUser: rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 3,
      keyGenerator: (req) => hmac(`mfa:setup:${req.user?.id}`),
      store: createStore(redisClient, 'rl:mfa:setup:') }),
    // Canonical action names share the same quota across route aliases and API versions.
    adminMutationByActor: build('rl:admin:mutation:', 30,
      (req) => hmac(`admin:${req.user?.id}:${req.adminMutationAction || 'unknown'}`)),
    verifyEmailByToken: rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 10,
      keyGenerator: (req) => hmac(`verification:${req.body?.token || 'invalid'}`),
      store: createStore(redisClient, 'rl:email:verify:') }),
    loginFailureGuard: createLoginFailureGuard(redisClient),
    identityDigest, identityPairKey, getGlobalBlockSeconds
  };

};

module.exports = {
  createAuthRateLimiters,
  createLoginFailureGuard,
  identityDigest,
  identityPairKey,
  normalizeIdentity,
  getGlobalBlockSeconds,
  FAILURE_TRACKING_LUA,
  LOGIN_STATE_LUA,
  RESET_LOGIN_STATE_LUA,
  registerCommands,
  runScript,
  redisUnavailable
};
