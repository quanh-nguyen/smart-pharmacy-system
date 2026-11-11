const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const totp = require('../utils/totp');
const sendSuccess = require('../utils/sendSuccess');
const { comparePassword } = require('../utils/password');
const setup = async (req, res) => {
  const user = await User.findById(req.user.id).select('+password +mfaPendingSecretEncrypted');
  if (!user || user.mfaEnabled) throw new ApiError(409, 'MFA đã được bật hoặc tài khoản không hợp lệ.');
  if (!req.body?.currentPassword || !await comparePassword(req.body.currentPassword, user.password)) {
    throw new ApiError(401, 'Mật khẩu xác minh không chính xác.', undefined, 'REAUTH_REQUIRED');
  }
  const secret = totp.newSecret();
  const update = await User.updateOne({ _id: user._id, mfaEnabled: false },
    { $set: { mfaPendingSecretEncrypted: totp.encrypt(secret) } });
  if (update.matchedCount !== 1) throw new ApiError(409, 'Trạng thái MFA đã thay đổi.');
  const uri = `otpauth://totp/SmartMedicine:${encodeURIComponent(user.email)}?secret=${totp.base32(Buffer.from(secret, 'hex'))}&issuer=SmartMedicine`;
  // URI is secret material: endpoint is authenticated and covered by no-store.
  return sendSuccess(res, 200, 'Thiết lập ứng dụng TOTP rồi xác nhận mã.', { secretHex: secret, uri });
};
const confirm = async (req, res) => {
  const user = await User.findById(req.user.id).select('+mfaPendingSecretEncrypted');
  if (!user?.mfaPendingSecretEncrypted) throw new ApiError(409, 'Chưa khởi tạo MFA.');
  const matchedStep = totp.matchStep(totp.decrypt(user.mfaPendingSecretEncrypted), req.body.code);
  if (matchedStep === null) throw new ApiError(401, 'Mã xác thực không chính xác.');
  const updated = await User.updateOne({ _id: user._id, mfaEnabled: false,
    mfaPendingSecretEncrypted: user.mfaPendingSecretEncrypted }, {
    $set: { mfaSecretEncrypted: user.mfaPendingSecretEncrypted, mfaEnabled: true, mfaLastUsedStep: matchedStep },
    $unset: { mfaPendingSecretEncrypted: '' }, $inc: { tokenVersion: 1 }
  });
  if (updated.matchedCount !== 1) throw new ApiError(409, 'MFA vừa thay đổi, vui lòng thử lại.');
  return sendSuccess(res, 200, 'MFA đã bật. Vui lòng đăng nhập lại.');
};
module.exports = { setup, confirm };
