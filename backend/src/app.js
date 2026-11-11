require('./bootstrap');
const path = require('node:path');
const express = require('express');
const ApiError = require('../auth/src/utils/ApiError');
const { createApp: createAuthApp } = require('../auth/src/app');

function createApp({ redisClient = null } = {}) {
  return createAuthApp({ redisClient,
    helmetOptions: {
      // The existing Leaflet frontend loads public fonts, tiles and map services.
      contentSecurityPolicy: { directives: {
        'script-src': ["'self'", 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'", 'https://*.tile.openstreetmap.org', 'https://overpass-api.de',
          'https://overpass.private.coffee', 'https://nominatim.openstreetmap.org', 'https://router.project-osrm.org'],
        'upgrade-insecure-requests': process.env.NODE_ENV === 'production' ? [] : null,
      } },
    },
    mountApplicationRoutes(app) {
      app.use('/api', express.json({ limit: '1mb', strict: true }));
      app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
      app.get('/api/health', async (_req, res) => {
        const checks = await Promise.allSettled([
          require('../catalog/src/config/db').pool.query('SELECT id FROM medicines LIMIT 1'),
          require('../operations/src/config/database').sequelize.query('SELECT id FROM orders LIMIT 1'),
        ]);
        const ready = checks.every(c => c.status === 'fulfilled') && (!redisClient || redisClient.status === 'ready');
        res.status(ready ? 200 : 503).json({ success: ready, status: ready ? 'ready' : 'not_ready' });
      });
      app.use('/api', require('./routes'));
      app.use('/api/pharmacies', require('../catalog/src/modules/pharmacies/pharmacies.routes'));
      app.use('/api/admin/pharmacies', require('../catalog/src/modules/pharmacies/pharmacies.admin.routes'));
      app.use('/api/medicines', require('../catalog/src/modules/medicines/medicines.routes'));
      app.use('/api', require('../catalog/src/modules/inventory/inventory.routes'));
      app.use('/api/search', require('../catalog/src/modules/search/search.routes'));
      for (const [name, file] of Object.entries({
        prescriptions: 'prescriptions/prescription', orders: 'orders/order',
        notifications: 'notifications/notification', symptoms: 'symptoms/symptom',
      })) app.use(`/api/${name}`, require(`../operations/src/modules/${file}.routes`));
      app.get('/runtime-config.js', (_req, res) => {
        res.type('application/javascript').set('Cache-Control', 'no-store')
          .send('window.SMART_PHARMACY_CONFIG = Object.freeze({ apiBaseUrl: "" });');
      });
      app.use(express.static(path.join(__dirname, '../../docs'), { index: 'index.html' }));
      // Translate the imported modules' operational errors to the Auth error contract.
      app.use((error, _req, _res, next) => {
        if (error instanceof ApiError) return next(error);
        if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
          return next(new ApiError(error.status, error.message));
        }
        if (error.code === 'ER_DUP_ENTRY' || error.name === 'SequelizeUniqueConstraintError') {
          return next(new ApiError(409, 'Dữ liệu đã tồn tại.'));
        }
        if (error.name === 'SequelizeForeignKeyConstraintError' || error.name === 'SequelizeValidationError') {
          return next(new ApiError(400, 'Dữ liệu tham chiếu không hợp lệ.'));
        }
        next(error);
      });
    },
  });
}
module.exports = { createApp };
