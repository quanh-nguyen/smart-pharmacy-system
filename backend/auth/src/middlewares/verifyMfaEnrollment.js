const jwt = require('jsonwebtoken');
const User = require('../models/User');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { Roles } = require('../constants/roles');

module.exports = async (req, _res, next) => {
  const header = req.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(header)) throw new ApiError(401, 'Yêu cầu enrollment challenge.');
  let decoded;
  try {
    decoded = jwt.verify(header.replace(/^Bearer\s+/i, ''), env.jwtSecret, {
      algorithms: ['HS256'], issuer: env.jwtIssuer,
      audience: `${env.jwtAudience}:mfa-enrollment`
    });
  } catch { throw new ApiError(401, 'Enrollment challenge không hợp lệ hoặc hết hạn.'); }
  if (decoded.purpose !== 'admin_mfa_enrollment' || !/^[a-f0-9]{24}$/i.test(decoded.sub || '') ||
      !Number.isSafeInteger(decoded.ver)) throw new ApiError(401, 'Enrollment challenge không hợp lệ.');
  const user = await User.findById(decoded.sub).select('role isActive mfaEnabled +tokenVersion').lean();
  if (!user || user.role !== Roles.ADMIN || user.isActive !== true || user.mfaEnabled ||
      user.tokenVersion !== decoded.ver) throw new ApiError(401, 'Enrollment challenge không còn hợp lệ.');
  req.user = { id: user._id.toString(), role: user.role, mfaEnabled: false, enrollmentOnly: true };
  next();
};
