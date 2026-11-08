const db = require('../auth/src/db/mysql');
const User = require('../auth/src/models/User');
const Events = require('../auth/src/models/PharmacyVerificationEvent');
const ApiError = require('../auth/src/utils/ApiError');

async function setVerification(id, status, actor, requestId) {
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new ApiError(400, 'Trạng thái duyệt không hợp lệ.');
  const session = await db.startSession();
  try {
    await session.withTransaction(async () => {
      const [rows] = await db.execute('SELECT owner_id FROM pharmacies WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw new ApiError(404, 'Không tìm thấy nhà thuốc.');
      const ownerId = rows[0].owner_id;
      if (!ownerId) throw new ApiError(409, 'Nhà thuốc chưa gắn với tài khoản chủ sở hữu.');
      await db.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [ownerId]);
      const owner = await User.findById(ownerId).lean();
      if (!owner || owner.role !== 'PHARMACY') throw new ApiError(409, 'Tài khoản chủ sở hữu không hợp lệ.');
      await db.execute('UPDATE pharmacies SET verification_status = ? WHERE id = ?', [status, id]);
      const verified = status === 'approved';
      if (owner.isVerified !== verified) {
        await User.updateOne({ _id: ownerId }, { $set: { isVerified: verified,
          verifiedAt: verified ? new Date() : null, verifiedBy: actor.id } });
        await Events.create({ pharmacyId: ownerId, changedBy: actor.id,
          previousValue: owner.isVerified, newValue: verified, changedAt: new Date(),
          reason: `Store ${id}: ${status}`, ...(requestId ? { requestId } : {}) });
      }
    });
  } finally { await session.endSession(); }
  return require('../catalog/src/modules/pharmacies/pharmacies.service').getById(id);
}
module.exports = { setVerification };
