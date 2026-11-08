const jwt = require('jsonwebtoken');
const env = require('../config/env');

const createAccessToken = (user) => {
  const tokenVersion = user.tokenVersion ?? 0;
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
    throw new TypeError('user.tokenVersion must be a non-negative integer.');
  }

  return jwt.sign(
    { ver: tokenVersion },
    env.jwtSecret,
    {
      algorithm: 'HS256',
      subject: user._id.toString(),
      issuer: env.jwtIssuer,
      audience: env.jwtAudience,
      expiresIn: env.jwtAccessExpiresIn
    }
  );
};

const createEnrollmentToken = (user) => jwt.sign(
  { ver: user.tokenVersion ?? 0, purpose: 'admin_mfa_enrollment' },
  env.jwtSecret,
  { algorithm: 'HS256', subject: user._id.toString(), issuer: env.jwtIssuer,
    audience: `${env.jwtAudience}:mfa-enrollment`, expiresIn: '5m' }
);

module.exports = { createAccessToken, createEnrollmentToken };
