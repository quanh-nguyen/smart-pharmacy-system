const User = require('../models/User');
const sqlDb = require('../db/mysql');
const { Roles } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const { comparePassword, hashPassword } = require('../utils/password');
const { revokeForUser } = require('./refreshTokenService');
const { objectIdSchema } = require('../validation/commonSchemas');
const logger = require('../config/logger');
const operationLedger = require('./securityOperationService');

const isUnknownCommit = (error) => error?.hasErrorLabel?.('UnknownTransactionCommitResult');
const contextFor = (userId, action, context) => {
  const actorId = context.actorId || userId;
  return { actorId, targetId: userId, action,
    operationId: operationLedger.makeOperationId(actorId, action, context.idempotencyKey) };
};
const reconcileSecurityCommit = async (context, error) => {
  if (!isUnknownCommit(error)) throw error;
  try {
    const record = await operationLedger.prior(context);
    if (record?.status === 'committed') return record.result;
  } catch {
    // A temporary DB disconnect must not be interpreted as confirmed rollback.
  }
  logger.warn({ event: 'security_transaction_commit_unknown', operationId: context.operationId },
    'Security operation outcome uncertain; query the durable operation status after reauthentication');
  const unknown = new ApiError(503,
    'Kết quả thao tác chưa xác định. Vui lòng đăng nhập lại và kiểm tra trạng thái thao tác.',
    undefined, 'SECURITY_OPERATION_COMMIT_UNKNOWN');
  unknown.operationId = context.operationId;
  throw unknown;
};
const run = async (context, apply) => {
  const existing = await operationLedger.prior(context);
  if (existing?.status === 'committed') return existing.result;
  const session = await sqlDb.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        // Double check inside transaction for same-key concurrent requests.
        const previously = await operationLedger.prior(context);
        if (previously) {
          result = previously.result;
          return;
        }
        result = await apply(session);
        await operationLedger.record({ ...context, result }, session);
      });
    } catch (error) {
      if (isUnknownCommit(error)) return await reconcileSecurityCommit(context, error);
      if (error.code === 11000 || error.code === 112 ||
          error.hasErrorLabel?.('TransientTransactionError')) {
        const committed = await operationLedger.prior(context);
        if (committed?.status === 'committed') return committed.result;
      }
      throw error;
    }
    return result;
  } finally { await session.endSession(); }
};

const revokeAllAccessTokens = async (userId, context = {}) => {
  const parsed = objectIdSchema.safeParse(userId);
  if (!parsed.success) throw new ApiError(400, 'ID tài khoản không hợp lệ.');
  const op = contextFor(parsed.data, 'LOGOUT_ALL', context);
  return run(op, async (session) => {
    const result = await User.updateOne({ _id: parsed.data },
      { $inc: { tokenVersion: 1 }, $set: { lastSecurityOperationId: op.operationId } },
      { session });
    if (result.matchedCount === 0) throw new ApiError(404, 'Không tìm thấy tài khoản.');
    await revokeForUser(parsed.data, { session });
    return true;
  });
};

const setAccountActiveStatus = async (userId, isActive, context = {}) => {
  const parsed = objectIdSchema.safeParse(userId);
  if (!parsed.success) throw new ApiError(400, 'ID tài khoản không hợp lệ.');
  if (typeof isActive !== 'boolean') throw new ApiError(400, 'isActive phải là boolean.');
  const op = contextFor(parsed.data, `SET_ACCOUNT_ACTIVE_${isActive}`, context);
  return run(op, async (session) => {
    const target = await User.findById(parsed.data).session(session);
    if (!target) throw new ApiError(404, 'Không tìm thấy tài khoản.');
    if (target.isActive === isActive) return false;
    if (!isActive && target.role === Roles.ADMIN && target.isActive === true) {
      // Serialize last-admin changes by writing the same guard document.
      const guard = await User.findOne({ role: Roles.ADMIN }).sort({ _id: 1 }).session(session);
      if (!guard) throw new ApiError(409, 'Không tìm thấy ADMIN hợp lệ.');
      await User.updateOne({ _id: guard._id }, { $inc: { adminSafetyEpoch: 1 } }, { session });
      const count = await User.countDocuments({ role: Roles.ADMIN, isActive: true }).session(session);
      if (count <= 1) throw new ApiError(409,
        'Không thể khóa ADMIN đang hoạt động cuối cùng.', undefined, 'LAST_ADMIN');
    }
    const updated = await User.updateOne({ _id: target._id, isActive: target.isActive },
      { $set: { isActive, lastSecurityOperationId: op.operationId },
        $inc: { tokenVersion: 1 } }, { session });
    if (updated.matchedCount !== 1) throw new ApiError(409,
      'Trạng thái tài khoản vừa thay đổi.', undefined, 'ACCOUNT_STATE_CONFLICT');
    await revokeForUser(parsed.data, { session });
    return true;
  });
};

const changePassword = async (userId, currentPassword, newPassword, context = {}) => {
  const op = contextFor(userId, 'CHANGE_PASSWORD', context);
  const already = await operationLedger.prior(op);
  if (already?.status === 'committed') return already.result;
  const user = await User.findById(userId).select('+password +tokenVersion');
  if (!user || user.isActive !== true || !await comparePassword(currentPassword, user.password)) {
    throw new ApiError(401, 'Mật khẩu hiện tại không chính xác.');
  }
  const hash = await hashPassword(newPassword);
  return run(op, async (session) => {
    const updated = await User.updateOne(
      { _id: user._id, password: user.password, isActive: true },
      { $set: { password: hash, passwordChangedAt: new Date(),
        lastSecurityOperationId: op.operationId }, $inc: { tokenVersion: 1 } },
      { session });
    if (updated.matchedCount !== 1) throw new ApiError(409, 'Mật khẩu đã thay đổi. Vui lòng thử lại.');
    await revokeForUser(userId, { session });
    return true;
  });
};
module.exports = { revokeAllAccessTokens, setAccountActiveStatus, changePassword };
