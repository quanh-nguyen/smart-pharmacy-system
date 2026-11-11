const accessTokenTtl = require('../utils/accessTokenTtl');
const User = require('../models/User');
const { Roles, SELF_REGISTERABLE_ROLES } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const { hashPassword, comparePassword, getDummyHash, needsRehash } = require('../utils/password');
const { createAccessToken, createEnrollmentToken } = require('../utils/token');
const env = require('../config/env');
const sqlDb = require('../db/mysql');
const logger = require('../config/logger');
const totp = require('../utils/totp');

const toPublicUser = (user) => typeof user.toPublicJSON === 'function'
  ? user.toPublicJSON()
  : { id: String(user._id), email: user.email, role: user.role,
    isVerified: user.isVerified, createdAt: user.createdAt };
const { issue: issueRefreshToken } = require('./refreshTokenService');
const buildAuthResult = async (user) => ({
  user: toPublicUser(user),
  accessToken: createAccessToken(user),
  ...(env.refreshTokensEnabled ? { refreshToken: await issueRefreshToken(user) } : {}),
  tokenType: 'Bearer',
  expiresIn: accessTokenTtl()
});

const register = async ({ email, password, role }) => {
  const assignedRole = role || Roles.CUSTOMER;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;

  // Defense in depth: callers that bypass request validation cannot create ADMIN accounts.
  if (!SELF_REGISTERABLE_ROLES.includes(assignedRole)) {
    throw new ApiError(403, 'Không được phép tự đăng ký với role này.');
  }

  // Avoid spending bcrypt CPU for a known duplicate. The unique index handles races.
  if (await User.exists({ email: normalizedEmail })) {
    throw new ApiError(409, 'Email đã được sử dụng.');
  }

  const passwordHash = await hashPassword(password);
  const payload = { email: normalizedEmail, password: passwordHash, role: assignedRole };
  if (!env.refreshTokensEnabled) {
    // Preserve the original non-refresh contract when the feature is disabled.
    return buildAuthResult(await User.create(payload));
  }

  // F06: account and first refresh session must either both commit or both roll back.
  // Do not sign or return any JWT before the transaction outcome is known.
  const session = await sqlDb.startSession();
  let createdUser;
  let initialRefreshToken;
  try {
    await session.withTransaction(async () => {
      [createdUser] = await User.create([payload], { session });
      initialRefreshToken = await issueRefreshToken(createdUser, { session });
    });
  } catch (error) {
    if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) {
      logger.warn({ event: 'registration_commit_unknown' },
        'Registration outcome unknown; client must use existing login/recovery flow');
      throw new ApiError(503,
        'Chưa thể xác nhận kết quả đăng ký. Vui lòng thử đăng nhập hoặc khôi phục tài khoản.',
        undefined, 'REGISTRATION_COMMIT_UNKNOWN');
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return {
    user: toPublicUser(createdUser),
    accessToken: createAccessToken(createdUser),
    refreshToken: initialRefreshToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenTtl()
  };
};

const login = async ({ email, password, totp: totpCode }) => {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;
  const user = await User.findOne({ email: normalizedEmail }).select('+password +tokenVersion +mfaSecretEncrypted +mfaLastUsedStep');
  const tooLong = Buffer.byteLength(password, 'utf8') > 72;
  const candidateHash = user && !tooLong ? user.password : await getDummyHash();
  const passwordMatches = await comparePassword(tooLong ? '' : password, candidateHash);

  if (!user || !passwordMatches || user.isActive !== true || !Number.isSafeInteger(user.tokenVersion) || user.tokenVersion < 0) {
    throw new ApiError(401, 'Email hoặc mật khẩu không chính xác.');
  }

  if (typeof needsRehash === 'function' && needsRehash(user.password)) {
    const oldHash = user.password;
    const strongerHash = await hashPassword(password);
    await User.updateOne(
      { _id: user._id, password: oldHash },
      { $set: { password: strongerHash } }
    );
  }

  if (user.role === Roles.ADMIN && !user.mfaEnabled) {
    // Never give a privileged access/refresh token before first-time MFA enrollment.
    return { mfaEnrollmentRequired: true, enrollmentToken: createEnrollmentToken(user),
      expiresIn: 300, tokenType: 'Bearer' };
  }
  if (user.role === Roles.ADMIN && user.mfaEnabled) {
    const step = user.mfaSecretEncrypted
      ? totp.matchStep(totp.decrypt(user.mfaSecretEncrypted), totpCode)
      : null;
    if (step === null) throw new ApiError(401, 'Email hoặc mật khẩu không chính xác.');
    // Strictly increasing steps ensure two concurrent attempts cannot reuse the
    // same TOTP, even if they run on separate API instances.
    const claimed = await User.updateOne({
      _id: user._id, role: Roles.ADMIN, mfaEnabled: true,
      tokenVersion: user.tokenVersion,
      $or: [{ mfaLastUsedStep: { $lt: step } },
        { mfaLastUsedStep: null }, { mfaLastUsedStep: { $exists: false } }]
    }, { $set: { mfaLastUsedStep: step } });
    if (claimed.matchedCount !== 1) {
      throw new ApiError(401, 'Mã xác thực đã được sử dụng hoặc phiên không còn hợp lệ.', undefined, 'MFA_REPLAY');
    }
  }
  return buildAuthResult(user);
};

module.exports = { register, login };
