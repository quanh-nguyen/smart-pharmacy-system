const express = require('express');
const authController = require('../controllers/authController');
const validateRequest = require('../middlewares/validateRequest');
const noStore = require('../middlewares/noStore');
const verifyToken = require('../middlewares/verifyToken');
const sessionController = require('../controllers/sessionController');
const { withSecurityOperation } = require('../middlewares/securityOperationHeaders');
const emailService = require('../services/emailVerificationService');
const sendSuccess = require('../utils/sendSuccess');
const { registerSchema, loginSchema, changePasswordSchema, refreshSchema } = require('../validation/authSchemas');
const { z } = require('zod');

const createAuthRoutes = (limiters) => {
  const { loginFailureGuard } = limiters;
  const ipLimiter = limiters.registerIpLimiter;
  const identityLimiter = limiters.registerIdentityLimiter;
  const router = express.Router();
  router.use(noStore);

  router.post(
    '/register',
    ipLimiter,
    identityLimiter,
    validateRequest({ body: registerSchema }),
    authController.register
  );

  router.post(
    '/login',
    limiters.loginIpLimiter || ipLimiter,
    limiters.loginIdentityLimiter || identityLimiter,
    validateRequest({ body: loginSchema }),
    loginFailureGuard,
    authController.login
  );

  router.get('/security-operations/:id', verifyToken,
    validateRequest({ params: z.object({ id: z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f-]{36})$/i) }).strict() }),
    sessionController.getSecurityOperation);
  router.post('/logout', verifyToken, withSecurityOperation('LOGOUT_ALL'), sessionController.logout);
  router.post('/change-password', verifyToken,
    limiters.changePwdByUser, limiters.changePwdByUserIp,
    withSecurityOperation('CHANGE_PASSWORD'),
    validateRequest({ body: changePasswordSchema }), sessionController.changePassword);
  router.post('/refresh', validateRequest({ body: refreshSchema }),
    limiters.refreshByIp, limiters.refreshBySession, sessionController.refresh);
  router.post('/request-email-verification', verifyToken,
    limiters.emailSendCooldown, limiters.emailSendDaily, async (req, res) => {
    await emailService.requestVerification(req.user.id);
    return sendSuccess(res, 200, 'Nếu email chưa xác minh, yêu cầu gửi hướng dẫn đã được tiếp nhận.');
  });
  router.post('/verify-email', validateRequest({ body: z.object({ token: z.string().length(43) }).strict() }),
    limiters.verifyEmailByToken,
    async (req, res) => {
      await emailService.verify(req.body.token);
      return sendSuccess(res, 200, 'Email đã được xác minh.');
    });
  return router;
};

module.exports = createAuthRoutes;
