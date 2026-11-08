const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

const verifyToken = async (req, res, next) => {
  const authHeader = req.get('authorization');

  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    throw new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.');
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new ApiError(401, 'Token không được để trống.');

  let decoded;
  try {
    decoded = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      issuer: env.jwtIssuer,
      audience: env.jwtAudience
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Phiên đăng nhập đã hết hạn.');
    }
    throw new ApiError(401, 'Token không hợp lệ.');
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof decoded.sub !== 'string' ||
    !OBJECT_ID_PATTERN.test(decoded.sub) ||
    !Number.isSafeInteger(decoded.ver) ||
    decoded.ver < 0 ||
    decoded.purpose !== undefined
  ) {
    throw new ApiError(401, 'Payload của token không hợp lệ.');
  }

  const user = await User.findById(decoded.sub)
    .select('role isVerified isActive mfaEnabled +tokenVersion')
    .lean();

  if (
    !user ||
    user.isActive !== true ||
    !Number.isSafeInteger(user.tokenVersion) ||
    user.tokenVersion < 0 ||
    user.tokenVersion !== decoded.ver
  ) {
    throw new ApiError(401, 'Phiên đăng nhập không còn hợp lệ.');
  }

  // Authorization data comes from the current database state, not JWT claims.
  req.user = {
    id: user._id.toString(),
    role: user.role,
    isVerified: user.isVerified,
    mfaEnabled: user.mfaEnabled
  };

  return next();
};

module.exports = verifyToken;
