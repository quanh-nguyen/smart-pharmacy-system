const crypto = require('crypto');
const { ApiError } = require('../utils/helpers');

// TAM THOI: bao ve cac route quan tri bang khoa trong .env (ADMIN_API_KEY), gui qua header x-admin-key.
// Chua cau hinh khoa thi route quan tri bi khoa han (an toan mac dinh).
// Khi module Auth (JWT + vai tro) xong, thay ham nay bang kiem tra vai tro admin.
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    return next(new ApiError(503, 'Chua cau hinh ADMIN_API_KEY, route quan tri dang bi khoa'));
  }
  const a = Buffer.from(String(req.get('x-admin-key') || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new ApiError(403, 'Khong co quyen quan tri'));
  }
  return next();
}

module.exports = { requireAdmin };
