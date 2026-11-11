const sqlDb = require('../db/mysql');
const User = require('../models/User');
const PharmacyVerificationEvent = require('../models/PharmacyVerificationEvent');
const ApiError = require('../utils/ApiError');
const { Roles } = require('../constants/roles');
const { objectIdSchema } = require('../validation/commonSchemas');

const setVerification = async (pharmacyId, adminId, isVerified, requestId, reason) => {
  const parsedId = objectIdSchema.safeParse(pharmacyId);
  if (!parsedId.success) throw new ApiError(400, 'ID nhà thuốc không hợp lệ.');
  if (typeof isVerified !== 'boolean') throw new ApiError(400, 'isVerified phải là boolean.');
  if (!sqlDb.isValidObjectId(adminId)) throw new ApiError(401, 'Tài khoản ADMIN không hợp lệ.');

  const session = await sqlDb.startSession();
  let resultingPharmacy;

  try {
    await session.withTransaction(async () => {
      const pharmacy = await User.findOne({ _id: parsedId.data, role: Roles.PHARMACY }).session(session);
      if (!pharmacy) throw new ApiError(404, 'Không tìm thấy nhà thuốc.');

      if (typeof pharmacy.isVerified !== 'boolean') {
        throw new ApiError(409, 'Trạng thái xác minh nhà thuốc không hợp lệ; cần chạy migration/review dữ liệu.');
      }

      // Repeating the same state is an idempotent no-op and does not manufacture an audit event.
      if (pharmacy.isVerified === isVerified) {
        resultingPharmacy = pharmacy;
        return;
      }

      const previousValue = pharmacy.isVerified;
      const changedAt = new Date();
      const updateResult = await User.updateOne(
        { _id: parsedId.data, role: Roles.PHARMACY, isVerified: previousValue },
        {
          $set: {
            isVerified,
            verifiedAt: isVerified ? changedAt : null,
            verifiedBy: isVerified ? adminId : null
          }
        },
        { session, runValidators: true }
      );

      if (updateResult.matchedCount !== 1) {
        throw new ApiError(409, 'Trạng thái nhà thuốc vừa thay đổi. Vui lòng tải lại và thử lại.');
      }

      await PharmacyVerificationEvent.create([{
        pharmacyId: pharmacy._id,
        changedBy: adminId,
        previousValue,
        newValue: isVerified,
        changedAt,
        requestId,
        reason: typeof reason === 'string' && reason.trim()
          ? reason.trim()
          : 'Không cung cấp lý do'
      }], { session });

      pharmacy.isVerified = isVerified;
      pharmacy.verifiedAt = isVerified ? changedAt : null;
      pharmacy.verifiedBy = isVerified ? adminId : null;
      resultingPharmacy = pharmacy;
    });

    return resultingPharmacy;
  } finally {
    await session.endSession();
  }
};

const encodeHistoryCursor = (event) => Buffer.from(JSON.stringify({
  changedAt: event.changedAt.toISOString(),
  id: event._id.toString()
})).toString('base64url');

const decodeHistoryCursor = (value) => {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const changedAt = new Date(decoded.changedAt);
    if (!sqlDb.isValidObjectId(decoded.id) || !Number.isFinite(changedAt.getTime())) throw new Error('invalid cursor');
    return { changedAt, id: new sqlDb.Types.ObjectId(decoded.id) };
  } catch (_error) {
    throw new ApiError(400, 'Cursor lịch sử xác minh không hợp lệ.');
  }
};

const getVerificationHistory = async (pharmacyId, { limit = 50, before } = {}) => {
  const parsedId = objectIdSchema.safeParse(pharmacyId);
  if (!parsedId.success) throw new ApiError(400, 'ID nhà thuốc không hợp lệ.');
  const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const objectId = new sqlDb.Types.ObjectId(parsedId.data);
  const pharmacy = await User.findOne({ _id: objectId, role: Roles.PHARMACY }).select('_id').lean();
  if (!pharmacy) throw new ApiError(404, 'Không tìm thấy nhà thuốc.');

  const cursor = decodeHistoryCursor(before);
  const filter = { pharmacyId: objectId };
  if (cursor) {
    filter.$or = [
      { changedAt: { $lt: cursor.changedAt } },
      { changedAt: cursor.changedAt, _id: { $lt: cursor.id } }
    ];
  }

  const rows = await PharmacyVerificationEvent.find(filter)
    .sort({ changedAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .lean();
  const hasMore = rows.length > pageSize;
  const events = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore && events.length ? encodeHistoryCursor(events[events.length - 1]) : null;

  let legacyHistory = [];
  let legacyHistoryTruncated = false;
  if (!before) {
    // Legacy embedded history remains readable from the native MySQL JSON column.
    // Project only the history field; no password hashes are serialized.
    const legacyDocument = await User.collection.findOne({ _id: objectId },
      { projection: { verificationHistory: 1 } });
    const legacyRows = Array.isArray(legacyDocument?.verificationHistory)
      ? legacyDocument.verificationHistory : [];
    legacyHistoryTruncated = legacyRows.length > 100;
    const visibleLegacyRows = (legacyHistoryTruncated ? legacyRows.slice(-100) : legacyRows).reverse();
    legacyHistory = visibleLegacyRows.map((event, index) => ({
      source: 'legacy_embedded',
      legacyIndex: legacyHistoryTruncated ? undefined : visibleLegacyRows.length - index - 1,
      isVerified: typeof event?.isVerified === 'boolean' ? event.isVerified : null,
      changedAt: event?.changedAt instanceof Date ? event.changedAt : null,
      changedBy: event?.changedBy?.toString?.() || null,
      requestId: typeof event?.requestId === 'string' ? event.requestId : null,
      reason: typeof event?.reason === 'string' ? event.reason : null
    }));
  }
  const eventDtos = events.map((event) => ({
    id: event._id.toString(),
    previousValue: event.previousValue,
    newValue: event.newValue,
    changedAt: event.changedAt,
    changedBy: event.changedBy?.toString?.() || null,
    requestId: event.requestId ?? null,
    reason: event.reason
  }));

  return {
    pharmacyId: objectId.toString(),
    events: eventDtos,
    pagination: { limit: pageSize, hasMore, nextCursor },
    legacyHistory,
    legacyHistoryTruncated
  };
};

module.exports = { setVerification, getVerificationHistory };
