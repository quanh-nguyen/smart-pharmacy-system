const express = require('express');
const { setDeprecationHeaders } = require('../middlewares/deprecationHeaders');
const noStore = require('../middlewares/noStore');
const { z } = require('zod');
const pharmacyController = require('../controllers/pharmacyController');
const verifyToken = require('../middlewares/verifyToken');
const requireAdminMfa = require('../middlewares/requireAdminMfa');
const checkRole = require('../middlewares/checkRole');
const validateRequest = require('../middlewares/validateRequest');
const { Roles } = require('../constants/roles');
const { objectIdSchema } = require('../validation/commonSchemas');

const createLegacyAdminRoutes = (limiters) => {
const router = express.Router();
router.use(noStore);
const pharmacyIdParamsSchema = z.object({ id: objectIdSchema }).strict();

// Deprecated compatibility route; same ADMIN policy as the versioned API.
router.put(
  '/verify-pharmacy/:id',
  verifyToken,
  checkRole([Roles.ADMIN]),
  requireAdminMfa,
  validateRequest({ params: pharmacyIdParamsSchema }),
  setDeprecationHeaders('legacy_admin_alias_request', '/verify-pharmacy/:id'),
  (req, _res, next) => {
    req.body = { isVerified: true, reason: 'Legacy compatibility route' };
    next();
  },
  (req, _res, next) => { req.adminMutationAction = 'pharmacy-verification'; next(); },
  limiters.adminMutationByActor,
  pharmacyController.setVerification
);
return router;
};
module.exports = createLegacyAdminRoutes;
