const path = require('path');
require('dotenv').config();

const root = path.join(__dirname, '..', '..');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    name: process.env.DB_NAME || 'pharmacy',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    logging: process.env.DB_LOGGING === 'true',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || 'uploads'),
  ocrLang: process.env.OCR_LANG || 'vie+eng',
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024,
};
