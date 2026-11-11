const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const env = require('./config/env');
const ApiError = require('./utils/ApiError');
const requestLogger = require('./middlewares/requestLogger');
const errorHandler = require('./middlewares/errorHandler');
const notFound = require('./middlewares/notFound');
const createAuthRoutes = require('./routes/authRoutes');
const createAdminRoutes = require('./routes/adminRoutes');
const legacyAdminRoutes = require('./routes/legacyAdminRoutes');
const createHealthRoutes = require('./routes/healthRoutes');
const pharmacyRoutes = require('./routes/pharmacyRoutes');
const { createAuthRateLimiters } = require('./middlewares/rateLimiters');
const { setDeprecationHeaders } = require('./middlewares/deprecationHeaders');

const createApp = ({ redisClient = null, mountApplicationRoutes = null, helmetOptions } = {}) => {
  const app = express();

  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  if (env.trustProxy !== false) app.set('trust proxy', env.trustProxy);

  app.use(requestLogger);
  app.use(helmet(helmetOptions));
  app.use(cors({
    exposedHeaders: ['X-Security-Operation-Id', 'X-Idempotency-Key', 'X-Refresh-Request-Id'],
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new ApiError(403, 'Origin không được phép truy cập API.'));
    },
    // Current API returns Bearer tokens in JSON; cookies/credentials are not used.
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key']
  }));

  const authJson = express.json({ limit: '10kb', strict: true });
  if (mountApplicationRoutes) {
    app.use(['/api/v1/auth', '/api/auth', '/api/v1/admin', '/api/v2/admin', '/api/admin', '/api/v1/pharmacy'], authJson);
  } else app.use(authJson);

  const limiters = createAuthRateLimiters(redisClient);

  app.use('/health', createHealthRoutes({ redisClient }));
  app.use('/api', limiters.apiLimiter);
  app.use('/api/v1/auth', createAuthRoutes(limiters));
  // Legacy aliases retain the same validation, rate limits and auth behavior during migration.
  app.use('/api/auth', setDeprecationHeaders('legacy_auth_alias_request', '/api/auth'),
    createAuthRoutes(limiters));
  app.use('/api/v1/admin', createAdminRoutes(limiters));
  app.use('/api/v2/admin', createAdminRoutes(limiters, { version: 'v2' }));
  app.use('/api/admin', legacyAdminRoutes(limiters));
  app.use('/api/v1/pharmacy', pharmacyRoutes);

  if (mountApplicationRoutes) mountApplicationRoutes(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };
