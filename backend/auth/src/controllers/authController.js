const authService = require('../services/authService');
const sendSuccess = require('../utils/sendSuccess');

const register = async (req, res) => {
  const data = await authService.register(req.body);
  return sendSuccess(res, 201, 'Đăng ký thành công.', data);
};

const login = async (req, res) => {
  let data;
  try {
    data = await authService.login(req.body);
  } catch (error) {
    if (error.statusCode === 401 && req.recordLoginFailure) await req.recordLoginFailure();
    throw error;
  }
  if (req.recordLoginSuccess) await req.recordLoginSuccess();
  return sendSuccess(res, 200, data.mfaEnrollmentRequired
    ? 'Cần thiết lập MFA trước khi truy cập quyền ADMIN.' : 'Đăng nhập thành công.', data);
};

module.exports = { register, login };
