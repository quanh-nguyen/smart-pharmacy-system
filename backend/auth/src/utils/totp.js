const crypto = require('node:crypto');
const env = require('../config/env');
const ApiError = require('./ApiError');
const keys = () => {
  const result = { ...(env.mfaEncryptionKeys || {}) };
  if (env.mfaEncryptionKey) result.legacy = env.mfaEncryptionKey;
  return result;
};
const activeKey = () => {
  const id = env.mfaActiveKeyId || 'legacy';
  const key = keys()[id];
  if (!key) throw new ApiError(503, 'MFA chưa được cấu hình.', undefined, 'MFA_NOT_CONFIGURED');
  return { id, key: Buffer.from(key, 'hex') };
};
const newSecret = () => crypto.randomBytes(20).toString('hex');
const encrypt = (secret) => {
  const { id, key } = activeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v2', id, iv, cipher.getAuthTag(), data]
    .map((part) => Buffer.isBuffer(part) ? part.toString('base64url') : part).join('.');
};
const decrypt = (value) => {
  const pieces = typeof value === 'string' ? value.split('.') : [];
  let keyId, parts;
  if (pieces[0] === 'v2' && pieces.length === 5) {
    keyId = pieces[1];
    parts = pieces.slice(2);
  } else if (pieces.length === 3) {
    // Legacy ciphertext had no key identifier. Keep old key configured until
    // all enrolled admins have been migrated to v2 ciphertexts.
    keyId = 'legacy';
    parts = pieces;
  } else {
    throw new Error('Unsupported MFA ciphertext envelope.');
  }
  const hex = keys()[keyId];
  if (!hex) throw new ApiError(503, 'Không có khóa để giải mã MFA.', undefined, 'MFA_KEY_UNAVAILABLE');
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid MFA ciphertext envelope.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};
const totpAt = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', Buffer.from(secret, 'hex')).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const numeric = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(numeric).padStart(6, '0');
};
// Return the exact accepted 30-second time-step, not a boolean, so MySQL can
// atomically reject reuse across workers. A null result is distinct from step 0.
const matchStep = (secret, code, now = Date.now()) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const skew of [0, -1, 1]) {
    const step = current + skew;
    if (step >= 0 && crypto.timingSafeEqual(
      Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step;
  }
  return null;
};
const verify = (secret, code) => matchStep(secret, code) !== null;
const base32 = (buf) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map((part) => alphabet[parseInt(part.padEnd(5, '0'), 2)]).join('');
};
module.exports = { newSecret, encrypt, decrypt, verify, matchStep, base32 };
