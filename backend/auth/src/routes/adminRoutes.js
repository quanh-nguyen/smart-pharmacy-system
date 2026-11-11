const express = require('express');
const pharmacyController = require('../controllers/pharmacyController');
const adminController = require('../controllers/adminController');
const sessionController = require('../controllers/sessionController');
const { withSecurityOperation } = require('../middlewares/securityOperationHeaders');
const mfaController = require('../controllers/mfaController');
const noStore = require('../middlewares/noStore');
const verifyToken = require('../middlewares/verifyToken');
const verifyMfaEnrollment = require('../middlewares/verifyMfaEnrollment');
const requireAdminMfa = require('../middlewares/requireAdminMfa');
const checkRole = require('../middlewares/checkRole');
const validateRequest = require('../middlewares/validateRequest');
const { Roles } = require('../constants/roles');
const { verificationSchema, accountStatusSchema, totpCodeSchema } = require('../validation/authSchemas');
const { z } = require('zod');
const { setDeprecationHeaders } = require('../middlewares/deprecationHeaders');
const pharmacyListSchema = (version) => z.object({ status: z.enum(['pending', 'verified', 'all']).default('pending'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().regex(/^[A-Za-z0-9_-]+$/).max(256).optional(),
  includeTotal: z.enum(['true', 'false']).default(version === 'v2' ? 'false' : 'true')
}).strict().superRefine(({ page, limit, before }, ctx) => {
  if (version === 'v2' && page > 1) {
    ctx.addIssue({ code: 'custom', path: ['page'], message: 'Use before/nextCursor in API v2.' });
  }
  if (!before && (page - 1) * limit > 10000) {
    ctx.addIssue({ code: 'custom', path: ['page'],
      message: 'Deep pagination requires a cursor (before).' });
  }
});
const { objectIdParamsSchema, verificationHistoryQuerySchema } = require('../validation/commonSchemas');

const createAdminRoutes = (limiters, { version = 'v1' } = {}) => {
const router = express.Router();
router.use(noStore);
router.post('/mfa/setup', verifyMfaEnrollment, limiters.mfaSetupByUser,
  validateRequest({ body: z.object({ currentPassword: z.string().min(1).max(1024) }).strict() }),
  mfaController.setup);
router.post('/mfa/confirm', verifyMfaEnrollment, limiters.mfaConfirmByUser,
  validateRequest({ body: totpCodeSchema }), mfaController.confirm);

router.get('/security-operations/:id', verifyToken, checkRole([Roles.ADMIN]), requireAdminMfa,
  validateRequest({ params: z.object({ id: z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f-]{36})$/i) }).strict() }),
  sessionController.getSecurityOperation);

router.get('/pharmacies', verifyToken, checkRole([Roles.ADMIN]), requireAdminMfa,
  validateRequest({ query: pharmacyListSchema(version) }), (req, res, next) => {
    if (version === 'v1' && req.validated.query.page > 1) {
      return setDeprecationHeaders('legacy_admin_pagination', '/pharmacies')(req, res, next);
    }
    next();
  }, adminController.listPharmacies);
router.patch('/users/:id/active', verifyToken, checkRole([Roles.ADMIN]), requireAdminMfa,
  (req, _res, next) => { req.adminMutationAction = 'account-active'; next(); },
  limiters.adminMutationByActor,
  validateRequest({ params: objectIdParamsSchema, body: accountStatusSchema }),
  withSecurityOperation((req) => `SET_ACCOUNT_ACTIVE_${req.body.isActive}`),
  adminController.setAccountActive);

router.get(
  '/pharmacies/:id/verification-history',
  verifyToken,
  checkRole([Roles.ADMIN]), requireAdminMfa,
  validateRequest({ params: objectIdParamsSchema, query: verificationHistoryQuerySchema }),
  pharmacyController.getVerificationHistory
);

router.patch(
  '/pharmacies/:id/verification',
  verifyToken,
  checkRole([Roles.ADMIN]), requireAdminMfa,
  (req, _res, next) => { req.adminMutationAction = 'pharmacy-verification'; next(); },
  limiters.adminMutationByActor,
  validateRequest({
    params: objectIdParamsSchema,
    body: verificationSchema
  }),
  pharmacyController.setVerification
);

return router;
};
module.exports = createAdminRoutes;
