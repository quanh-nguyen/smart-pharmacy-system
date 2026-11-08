// Whitelist safe diagnostics: never serialize raw database keyValue, errInfo,
// request bodies or library-specific objects containing PII.
const scrub = (value) => String(value || '').slice(0, 8192)
  .replace(/\b(mysql|mongodb(?:\+srv)?|rediss?):\/\/[^@\s/]+@/gi, '$1://[REDACTED]@')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
  .replace(/(password|passwd|secret|token)(\s*[=:]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
  .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[JWT_REDACTED]')
  .replace(/(verify-email\?token=)[^&\s]+/gi, '$1[REDACTED]')
  .replace(/otpauth:\/\/[^\s]+/gi, '[TOTP_URI_REDACTED]');
const toLoggableError = (error) => ({
  name: typeof error?.name === 'string' ? error.name : 'Error',
  code: typeof error?.code === 'string' || typeof error?.code === 'number' ? error.code : undefined,
  message: error?.code === 11000 ? 'Duplicate key violation' : scrub(error?.message),
  stack: error?.code === 11000 ? undefined : scrub(error?.stack)
});
module.exports = { toLoggableError, scrub };
