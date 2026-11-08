const crypto = require('node:crypto');
const { makeOperationId } = require('../services/securityOperationService');

const withSecurityOperation = (action) => (req, res, next) => {
  try {
    const key = req.get('Idempotency-Key') || crypto.randomUUID();
    const resolvedAction = typeof action === 'function' ? action(req) : action;
    const operationId = makeOperationId(req.user.id, resolvedAction, key);
    req.securityOperation = { actorId: req.user.id, idempotencyKey: key };
    res.set('X-Security-Operation-Id', operationId);
    res.set('X-Idempotency-Key', key);
    return next();
  } catch (error) {
    return next(error);
  }
};
module.exports = { withSecurityOperation };
