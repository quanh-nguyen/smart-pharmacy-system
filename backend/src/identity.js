require('./bootstrap');
const verifyAuthToken = require('../auth/src/middlewares/verifyToken');
const ApiError = require('../auth/src/utils/ApiError');
const roles = { CUSTOMER: 'customer', PHARMACY: 'pharmacy', ADMIN: 'admin' };

async function verifyToken(token) {
  const request = { get: (name) => name.toLowerCase() === 'authorization' ? `Bearer ${token || ''}` : undefined };
  await verifyAuthToken(request, null, () => {});
  const identity = request.user;
  if (identity.role === 'ADMIN' && identity.mfaEnabled !== true) {
    throw new ApiError(403, 'Cần hoàn tất MFA trước khi sử dụng quyền ADMIN.');
  }
  if (!roles[identity.role]) throw new ApiError(403, 'Vai trò không hợp lệ.');
  return { ...identity, role: roles[identity.role] };
}

async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(header)) throw new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.');
    req.user = await verifyToken(header.replace(/^Bearer\s+/i, ''));
    next();
  } catch (error) { next(error); }
}

function authorize(...allowed) {
  return (req, _res, next) => allowed.includes(req.user?.role)
    ? next() : next(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.'));
}

module.exports = { authenticate, authorize, verifyToken };
