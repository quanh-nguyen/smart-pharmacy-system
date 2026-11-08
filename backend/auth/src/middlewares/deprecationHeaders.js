const env = require('../config/env');
const logger = require('../config/logger');

// Headers have one release-managed source; do not promise a sunset by default.
const setDeprecationHeaders = (event, route) => (req, res, next) => {
  res.set('Deprecation', 'true');
  if (env.legacyApiSunset) res.set('Sunset', env.legacyApiSunset);
  logger.info({ event, route, method: req.method }, 'Deprecated API used');
  next();
};
module.exports = { setDeprecationHeaders };
