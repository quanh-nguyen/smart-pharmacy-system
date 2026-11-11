const { randomUUID } = require('node:crypto');
const pinoHttp = require('pino-http');
const logger = require('../config/logger');

// Always generate an internal correlation ID. Client-supplied X-Request-ID is untrusted.
const requestLogger = pinoHttp({
  logger,
  genReqId(_req, res) {
    const id = randomUUID();
    res.setHeader('X-Request-ID', id);
    return id;
  },
  autoLogging: { ignore: (req) => req.url?.startsWith('/health') },
  customProps: (req) => ({ requestId: req.id }),
  serializers: {
    req(req) {
      return { id: req.id, method: req.method, url: String(req.url || '').split('?')[0] };
    }
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  }
});

module.exports = requestLogger;
