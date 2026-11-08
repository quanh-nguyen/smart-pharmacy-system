const sqlDb = require('../db/mysql');
const ApiError = require('./ApiError');
// Cursor is scoped to its exact status filter; it cannot be replayed for all/pending/verified.
const encode = (row, status) => Buffer.from(JSON.stringify({
  createdAt: row.createdAt.toISOString(), id: row._id.toString(), status
})).toString('base64url');
const decode = (value, status) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const date = new Date(parsed.createdAt);
    if (parsed.status !== status || !Number.isFinite(date.getTime()) ||
      !sqlDb.isValidObjectId(parsed.id)) throw new Error('Invalid cursor');
    return { createdAt: date, id: new sqlDb.Types.ObjectId(parsed.id) };
  } catch {
    throw new ApiError(400, 'Cursor danh sách nhà thuốc không hợp lệ.', undefined, 'INVALID_CURSOR');
  }
};
module.exports = { encode, decode };
