const crypto = require('node:crypto');
const env = require('../config/env');

// v1 remains readable with the original key while records are rewrapped.
// v2 embeds a non-sensitive key identifier, never the key itself.
const keyring = () => env.mailOutboxEncryptionKeys || {};
const activeKey = () => {
  if (env.mailOutboxActiveKeyId) {
    const value = keyring()[env.mailOutboxActiveKeyId];
    if (!value) throw new Error('Active mail outbox encryption key is unavailable.');
    return { id: env.mailOutboxActiveKeyId, key: Buffer.from(value, 'hex') };
  }
  if (!env.mailOutboxEncryptionKey) throw new Error('Mail outbox encryption is not configured.');
  return { id: null, key: Buffer.from(env.mailOutboxEncryptionKey, 'hex') };
};
const partsOf = (envelope) => {
  if (typeof envelope !== 'string') throw new Error('Invalid mail outbox envelope.');
  const pieces = envelope.split('.');
  if (pieces[0] === 'v1' && pieces.length === 4) return {
    version: 'v1', kid: null, pieces: pieces.slice(1)
  };
  if (pieces[0] === 'v2' && pieces.length === 5 && /^[a-zA-Z0-9_-]{1,32}$/.test(pieces[1])) {
    return { version: 'v2', kid: pieces[1], pieces: pieces.slice(2) };
  }
  throw new Error('Unsupported mail outbox envelope.');
};
const inspectKeyId = (envelope) => {
  const parsed = partsOf(envelope);
  return parsed.kid || 'legacy-v1';
};
const seal = (payload) => {
  const { id, key } = activeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const components = [id ? 'v2' : 'v1', ...(id ? [id] : []),
    iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')];
  return components.join('.');
};
const unseal = (envelope) => {
  const { version, kid, pieces } = partsOf(envelope);
  const hex = version === 'v1' ? env.mailOutboxEncryptionKey : keyring()[kid];
  if (!hex) throw new Error('Required historical mail outbox key is unavailable.');
  const [ivText, tagText, ciphertextText] = pieces;
  if (!ivText || !tagText || !ciphertextText ||
      ![ivText, tagText, ciphertextText].every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error('Malformed mail outbox envelope.');
  }
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid mail outbox authentication data.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()
  ]).toString('utf8'));
};
module.exports = { seal, unseal, inspectKeyId };
