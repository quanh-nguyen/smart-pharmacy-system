const env = require('../config/env');
// Do not allow privileged maintenance actions with a runtime-only DB account.
const assertMaintenancePrincipal = (config = env) => {
  if (config.nodeEnv === 'production' &&
    (!config.mysqlMaintenanceUser || !config.mysqlMaintenancePassword ||
     config.mysqlMaintenanceUser === config.mysqlUser)) {
    throw new Error('Production maintenance requires separately configured MYSQL_MAINTENANCE_USER.');
  }
};
module.exports = { assertMaintenancePrincipal };
