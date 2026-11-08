const pino = require('pino');
const env = require('./env');

const logger = pino({
  level: env.logLevel,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]'
    ],
    censor: '[REDACTED]'
  },
  serializers: { err: pino.stdSerializers.err },
  timestamp: pino.stdTimeFunctions.isoTime
});

module.exports = logger;
