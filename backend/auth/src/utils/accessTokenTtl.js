const env = require('../config/env');
const TTL_SECONDS = Object.freeze({ '15m': 900, '30m': 1800, '45m': 2700, '60m': 3600 });
module.exports = () => TTL_SECONDS[env.jwtAccessExpiresIn];
