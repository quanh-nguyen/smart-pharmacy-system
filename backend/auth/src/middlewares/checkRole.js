const ApiError = require('../utils/ApiError');

const checkRole = (allowedRoles = []) => {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new TypeError('allowedRoles must be a non-empty array.');
  }

  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Bạn không có quyền thực hiện hành động này.'));
    }

    return next();
  };
};

module.exports = checkRole;
