const { Roles } = require('../constants/roles');
const ApiError = require('../utils/ApiError');

// Use after verifyToken and checkRole([Roles.PHARMACY]) on every pharmacy operation route.
const requireVerifiedPharmacy = (req, res, next) => {
  if (!req.user || req.user.role !== Roles.PHARMACY) {
    return next(new ApiError(403, 'Chỉ nhà thuốc mới được phép truy cập.'));
  }

  if (req.user.isVerified !== true) {
    return next(new ApiError(403, 'Nhà thuốc chưa được ADMIN xác minh.'));
  }

  return next();
};

module.exports = requireVerifiedPharmacy;
