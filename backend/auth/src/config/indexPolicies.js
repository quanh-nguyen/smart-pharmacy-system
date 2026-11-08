// Current/legacy database index descriptors. Historical migrations 001-006 are immutable.
const AUDIT_CURSOR_INDEX_NAME = 'idx_pharmacy_verification_cursor_v2';
const AUDIT_CURSOR_INDEX_KEYS = Object.freeze({ pharmacyId: 1, changedAt: -1, _id: -1, requestId: 1 });
const LEGACY_AUDIT_CURSOR_INDEX_NAME = 'idx_pharmacy_verification_pharmacy_changed_at';
const LEGACY_AUDIT_CURSOR_INDEX_KEYS = Object.freeze({ pharmacyId: 1, changedAt: -1, _id: -1 });
const EMAIL_OUTBOX_AGE_INDEX = Object.freeze({
  name: 'idx_email_outbox_status_age',
  key: Object.freeze({ kind: 1, status: 1, createdAt: 1 })
});
const EMAIL_VERIFICATION_LOOKUP_INDEX = Object.freeze({
  name: 'idx_users_email_verification_hash',
  key: Object.freeze({ emailVerificationHash: 1 }),
  options: Object.freeze({ partialFilterExpression: { emailVerificationHash: { $type: 'string' } } })
});
const EMAIL_OUTBOX_DEAD_LETTER_INDEX = Object.freeze({
  name: 'idx_email_outbox_verification_recovery',
  key: Object.freeze({ kind: 1, userId: 1, tokenHash: 1, status: 1 })
});
const PHARMACY_LIST_INDEXES = Object.freeze([
  Object.freeze({ name: 'idx_users_role_created_id', key: Object.freeze({ role: 1, createdAt: -1, _id: -1 }) }),
  Object.freeze({ name: 'idx_users_role_verification_created_id', key: Object.freeze({ role: 1, isVerified: 1, createdAt: -1, _id: -1 }) })
]);
const sameIndex = (index, name, key) => index?.name === name &&
  JSON.stringify(Object.entries(index.key || {})) === JSON.stringify(Object.entries(key));
const isGlobalUniqueEmailIndex = (index) => {
  const entries = Object.entries(index.key || {});
  return index.unique === true && index.sparse !== true && !index.partialFilterExpression &&
    entries.length === 1 && entries[0][0] === 'email' && entries[0][1] === 1 &&
    (!index.collation || index.collation.locale === 'simple');
};
const isAuditCursorIndex = (index) => sameIndex(index, AUDIT_CURSOR_INDEX_NAME, AUDIT_CURSOR_INDEX_KEYS);
const isLegacyAuditCursorIndex = (index) => sameIndex(index,
  LEGACY_AUDIT_CURSOR_INDEX_NAME, LEGACY_AUDIT_CURSOR_INDEX_KEYS);
module.exports = { AUDIT_CURSOR_INDEX_NAME, AUDIT_CURSOR_INDEX_KEYS,
  LEGACY_AUDIT_CURSOR_INDEX_NAME, LEGACY_AUDIT_CURSOR_INDEX_KEYS,
  PHARMACY_LIST_INDEXES, EMAIL_OUTBOX_AGE_INDEX, EMAIL_VERIFICATION_LOOKUP_INDEX,
  EMAIL_OUTBOX_DEAD_LETTER_INDEX, sameIndex,
  isGlobalUniqueEmailIndex, isAuditCursorIndex, isLegacyAuditCursorIndex };
