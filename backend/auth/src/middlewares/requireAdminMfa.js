const ApiError = require('../utils/ApiError');
module.exports = (req, _res, next) => {
  if (req.user?.role === 'ADMIN' && req.user.mfaEnabled !== true) {
    return next(new ApiError(403, 'Cần hoàn tất MFA trước khi sử dụng quyền ADMIN.', undefined, 'MFA_REQUIRED'));
  }
  return next();
};
