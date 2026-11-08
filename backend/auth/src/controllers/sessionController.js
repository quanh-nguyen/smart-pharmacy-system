const sessionService = require('../services/sessionService');
const { rotate } = require('../services/refreshTokenService');
const sendSuccess = require('../utils/sendSuccess');
const operationLedger = require('../services/securityOperationService');
const ApiError = require('../utils/ApiError');
const logout = async (req, res) => {
  await sessionService.revokeAllAccessTokens(req.user.id, req.securityOperation);
  return sendSuccess(res, 200, 'Đã đăng xuất trên mọi thiết bị.');
};
const changePassword = async (req, res) => {
  await sessionService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword,
    req.securityOperation);
  return sendSuccess(res, 200, 'Mật khẩu đã thay đổi; các phiên cũ không còn hợp lệ.');
};
const refresh = async (req, res) => {
  // The client correlates retries and MUST serialize refresh across tabs.
  // A consumed token is always treated as compromised until Security approves
  // a proof-bound idempotency mechanism; do not return replacement tokens on replay.
  if (req.id) res.set('X-Refresh-Request-Id', String(req.id));
  return sendSuccess(res, 200, 'Làm mới phiên đăng nhập thành công.',
    await rotate(req.body.refreshToken));
};
const getSecurityOperation = async (req, res) => {
  const result = await operationLedger.get(req.user.id, req.params.id);
  if (!result) throw new ApiError(404, 'Không tìm thấy thao tác bảo mật.', undefined, 'OPERATION_NOT_FOUND');
  return sendSuccess(res, 200, 'Trạng thái thao tác bảo mật.', {
    operationId: req.params.id, action: result.action,
    status: result.status, createdAt: result.createdAt
  });
};
module.exports = { logout, changePassword, refresh, getSecurityOperation };
