const dotenv = require('dotenv');
const crypto = require('node:crypto');
const { z } = require('zod');

dotenv.config();

const trustProxySchema = z.preprocess((value) => {
  if (value === undefined || value === '' || value === 'false') return false;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return value;
}, z.union([
  z.literal(false),
  z.number().int().min(1).max(10),
  z.string().trim().min(1).refine((value) =>
    value.toLowerCase() !== 'true' &&
    (['loopback', 'linklocal', 'uniquelocal'].includes(value) ||
      value.split(',').every((part) => /^(?:[0-9a-fA-F:.]+)(?:\/\d{1,3})?$/.test(part.trim()))),
  'Chỉ được dùng số hop, loopback/uniquelocal hoặc danh sách IP/CIDR tin cậy.')
]));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MYSQL_HOST: z.string().trim().min(1).default('127.0.0.1'),
  MYSQL_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  MYSQL_USER: z.string().trim().min(1, 'MYSQL_USER is required'),
  MYSQL_PASSWORD: z.string().default(''),
  MYSQL_DATABASE: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  MYSQL_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MYSQL_MAINTENANCE_USER: z.string().trim().optional(),
  MYSQL_MAINTENANCE_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string()
    .min(32, 'JWT_SECRET must contain at least 32 characters')
    .refine((secret) => !secret.toLowerCase().startsWith('replace_'), 'Replace the example JWT_SECRET with a random secret'),
  JWT_ISSUER: z.string().trim().min(1).default('smart-medicine-api'),
  JWT_AUDIENCE: z.string().trim().min(1).default('smart-medicine-client'),
  JWT_ACCESS_EXPIRES_IN: z.enum(['15m', '30m', '45m', '60m']).default('15m'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  BCRYPT_MAX_CONCURRENT: z.coerce.number().int().min(1).max(32).default(2),
  BCRYPT_MAX_QUEUE: z.coerce.number().int().min(1).max(1000).default(50),
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform((value) =>
    [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))]
  ),
  TRUST_PROXY: trustProxySchema.default(false),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_IP_MAX: z.coerce.number().int().min(1).default(30),
  // Limit for an IP + email pair, not a global per-email limit.
  AUTH_RATE_LIMIT_IDENTITY_MAX: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_LIMIT_FAILURE_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_FAILURES: z.coerce.number().int().min(10).max(1000).default(30),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_IPS: z.coerce.number().int().min(3).max(100).default(5),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_FAILURES: z.coerce.number().int().min(20).max(2000).default(60),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_IPS: z.coerce.number().int().min(5).max(200).default(10),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_FAILURES: z.coerce.number().int().min(30).max(5000).default(100),
  AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_IPS: z.coerce.number().int().min(10).max(500).default(20),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  AUTH_RATE_LIMIT_HMAC_SECRET: z.string().trim().optional().transform((value) => value || undefined),
  REDIS_URL: z.string().optional().transform((value) => value?.trim() || undefined),
  ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DEPLOYMENT_REPLICAS: z.coerce.number().int().min(1).max(10000).default(1),
  RATE_LIMIT_MEMORY_EMERGENCY_APPROVAL: z.string().trim().optional(),
  RATE_LIMIT_MEMORY_EMERGENCY_EXPIRES_AT: z.string().trim().optional(),
  REFRESH_TOKENS_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MAIL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_OUTBOX_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value,
    z.string().regex(/^[0-9a-fA-F]{64}$/).optional()),
  MAIL_OUTBOX_ENCRYPTION_KEYS: z.string().optional(),
  MAIL_OUTBOX_ACTIVE_KEY_ID: z.preprocess((v) => v === '' ? undefined : v,
    z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional()),
  PUBLIC_APP_URL: z.string().url().optional(),
  MFA_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value,
    z.string().regex(/^[0-9a-fA-F]{64}$/).optional()),
  MFA_ENCRYPTION_KEYS: z.string().optional(),
  MFA_ACTIVE_KEY_ID: z.preprocess((value) => value === '' ? undefined : value,
    z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional()),
  LEGACY_API_SUNSET: z.string().trim().optional().refine((value) => !value ||
    (Number.isFinite(Date.parse(value)) && /GMT$/i.test(value)),
    'LEGACY_API_SUNSET must be an RFC1123 GMT date'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && data.CORS_ORIGINS.some((origin) => {
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
    } catch { return true; }
  })) {
    ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'CORS origin localhost/invalid không được dùng trong production.' });
  }
  if (data.REDIS_URL && (!data.AUTH_RATE_LIMIT_HMAC_SECRET || data.AUTH_RATE_LIMIT_HMAC_SECRET.length < 32 || data.AUTH_RATE_LIMIT_HMAC_SECRET.toLowerCase().startsWith('replace_'))) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_RATE_LIMIT_HMAC_SECRET'],
      message: 'A separate AUTH_RATE_LIMIT_HMAC_SECRET of at least 32 characters is required when REDIS_URL is configured'
    });
  }


  if (data.NODE_ENV === 'production' && !data.MFA_ENCRYPTION_KEY && !data.MFA_ENCRYPTION_KEYS) {
    ctx.addIssue({ code: 'custom', path: ['MFA_ENCRYPTION_KEY'],
      message: 'Production ADMIN MFA requires MFA_ENCRYPTION_KEY (64 hex characters).' });
  }

  if (data.MAIL_OUTBOX_ENCRYPTION_KEYS) {
    try {
      const keys = JSON.parse(data.MAIL_OUTBOX_ENCRYPTION_KEYS);
      if (!keys || Array.isArray(keys) || typeof keys !== 'object' || !Object.keys(keys).length ||
          Object.entries(keys).some(([kid, hex]) => !/^[a-zA-Z0-9_-]{1,32}$/.test(kid) ||
            typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) ||
          !data.MAIL_OUTBOX_ACTIVE_KEY_ID || !Object.hasOwn(keys, data.MAIL_OUTBOX_ACTIVE_KEY_ID)) {
        throw new Error('Invalid keyring');
      }
    } catch {
      ctx.addIssue({ code: 'custom', path: ['MAIL_OUTBOX_ENCRYPTION_KEYS'],
        message: 'Provide JSON kid->64hex keys and a matching MAIL_OUTBOX_ACTIVE_KEY_ID.' });
    }
  } else if (data.MAIL_OUTBOX_ACTIVE_KEY_ID) {
    ctx.addIssue({ code: 'custom', path: ['MAIL_OUTBOX_ACTIVE_KEY_ID'],
      message: 'Active mail key ID requires MAIL_OUTBOX_ENCRYPTION_KEYS.' });
  }
  if (data.MFA_ENCRYPTION_KEYS) {
    try {
      const entries = JSON.parse(data.MFA_ENCRYPTION_KEYS);
      if (!entries || Array.isArray(entries) || typeof entries !== 'object' ||
          !Object.keys(entries).length ||
          Object.entries(entries).some(([id, key]) => !/^[a-zA-Z0-9_-]{1,32}$/.test(id) ||
            typeof key !== 'string' || !/^[0-9a-fA-F]{64}$/.test(key)) ||
          !data.MFA_ACTIVE_KEY_ID || !Object.hasOwn(entries, data.MFA_ACTIVE_KEY_ID)) {
        throw new Error('Invalid MFA encryption key map or active key ID');
      }
    } catch {
      ctx.addIssue({ code: 'custom', path: ['MFA_ENCRYPTION_KEYS'],
        message: 'Expected JSON map id->64hex key and MFA_ACTIVE_KEY_ID matching the map.' });
    }
  }
  if (data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_FAILURES <= data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_FAILURES) {
    ctx.addIssue({ code: 'custom', path: ['AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_FAILURES'], message: 'Second-level failures must exceed first-level failures' });
  }
  if (data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_FAILURES <= data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_FAILURES) {
    ctx.addIssue({ code: 'custom', path: ['AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_FAILURES'], message: 'Third-level failures must exceed second-level failures' });
  }
  if (data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_IPS <= data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_IPS) {
    ctx.addIssue({ code: 'custom', path: ['AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_IPS'], message: 'Second-level distinct IP count must exceed first-level count' });
  }
  if (data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_IPS <= data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_IPS) {
    ctx.addIssue({ code: 'custom', path: ['AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_IPS'], message: 'Third-level distinct IP count must exceed second-level count' });
  }

  if (data.NODE_ENV === 'production' && !data.REDIS_URL &&
    data.ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION) {
    const expiry = Date.parse(data.RATE_LIMIT_MEMORY_EMERGENCY_EXPIRES_AT || '');
    const remaining = expiry - Date.now();
    if (!process.env.DEPLOYMENT_REPLICAS || data.DEPLOYMENT_REPLICAS !== 1 ||
        !data.RATE_LIMIT_MEMORY_EMERGENCY_APPROVAL ||
        data.RATE_LIMIT_MEMORY_EMERGENCY_APPROVAL.length < 8 ||
        !Number.isFinite(expiry) || remaining <= 0 || remaining > 24 * 3600_000) {
      ctx.addIssue({ code: 'custom', path: ['ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION'],
        message: 'Emergency memory limiter requires exactly one replica, approval reference and expiry within 24 hours.' });
    }
  }
  if (
    data.NODE_ENV === 'production' &&
    !data.REDIS_URL &&
    !data.ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_URL'],
      message: 'Production requires REDIS_URL unless ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION=true is an explicit single-instance decision'
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const data = parsed.data;
const hmacSecret = data.AUTH_RATE_LIMIT_HMAC_SECRET || crypto.randomBytes(32).toString('hex');

module.exports = Object.freeze({
  nodeEnv: data.NODE_ENV,
  port: data.PORT,
  mysqlHost: data.MYSQL_HOST,
  mysqlPort: data.MYSQL_PORT,
  mysqlUser: data.MYSQL_USER,
  mysqlPassword: data.MYSQL_PASSWORD,
  mysqlDatabase: data.MYSQL_DATABASE,
  mysqlPoolSize: data.MYSQL_POOL_SIZE,
  mysqlMaintenanceUser: data.MYSQL_MAINTENANCE_USER,
  mysqlMaintenancePassword: data.MYSQL_MAINTENANCE_PASSWORD,
  jwtSecret: data.JWT_SECRET,
  jwtIssuer: data.JWT_ISSUER,
  jwtAudience: data.JWT_AUDIENCE,
  jwtAccessExpiresIn: data.JWT_ACCESS_EXPIRES_IN,
  bcryptSaltRounds: data.BCRYPT_SALT_ROUNDS,
  bcryptMaxConcurrent: data.BCRYPT_MAX_CONCURRENT,
  bcryptMaxQueue: data.BCRYPT_MAX_QUEUE,
  corsOrigins: data.CORS_ORIGINS,
  trustProxy: data.TRUST_PROXY,
  authRateLimitWindowMs: data.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitIpMax: data.AUTH_RATE_LIMIT_IP_MAX,
  authRateLimitIdentityMax: data.AUTH_RATE_LIMIT_IDENTITY_MAX,
  authRateLimitFailureWindowSeconds: data.AUTH_RATE_LIMIT_FAILURE_WINDOW_SECONDS,
  authRateLimitGlobalBlockMinFailures: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_FAILURES,
  authRateLimitGlobalBlockMinIps: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_MIN_IPS,
  authRateLimitGlobalBlockSecondLevelFailures: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_FAILURES,
  authRateLimitGlobalBlockSecondLevelIps: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_SECOND_LEVEL_IPS,
  authRateLimitGlobalBlockThirdLevelFailures: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_FAILURES,
  authRateLimitGlobalBlockThirdLevelIps: data.AUTH_RATE_LIMIT_GLOBAL_BLOCK_THIRD_LEVEL_IPS,
  redisConnectTimeoutMs: data.REDIS_CONNECT_TIMEOUT_MS,
  authRateLimitHmacSecret: hmacSecret,
  redisUrl: data.REDIS_URL,
  allowInMemoryRateLimitInProduction: data.ALLOW_IN_MEMORY_RATE_LIMIT_IN_PRODUCTION,
  deploymentReplicas: data.DEPLOYMENT_REPLICAS,
  refreshTokensEnabled: data.REFRESH_TOKENS_ENABLED,
  mailApiKey: data.MAIL_API_KEY,
  mailFrom: data.MAIL_FROM,
  mailOutboxEncryptionKey: data.MAIL_OUTBOX_ENCRYPTION_KEY,
  mailOutboxEncryptionKeys: data.MAIL_OUTBOX_ENCRYPTION_KEYS ? JSON.parse(data.MAIL_OUTBOX_ENCRYPTION_KEYS) : undefined,
  mailOutboxActiveKeyId: data.MAIL_OUTBOX_ACTIVE_KEY_ID,
  publicAppUrl: data.PUBLIC_APP_URL,
  mfaEncryptionKey: data.MFA_ENCRYPTION_KEY,
  mfaEncryptionKeys: data.MFA_ENCRYPTION_KEYS ? JSON.parse(data.MFA_ENCRYPTION_KEYS) : undefined,
  mfaActiveKeyId: data.MFA_ACTIVE_KEY_ID,
  legacyApiSunset: data.LEGACY_API_SUNSET,
  logLevel: data.LOG_LEVEL
});
