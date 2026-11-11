const User = require('../models/User');
const { Roles } = require('../constants/roles');
const ApiError = require('../utils/ApiError');
const cursor = require('../utils/pharmacyListCursor');

const list = async ({ page, limit, status, before, includeTotal }) => {
  if (before && page !== 1) {
    throw new ApiError(400, 'Không thể dùng page và cursor đồng thời.');
  }
  const baseFilter = { role: Roles.PHARMACY };
  if (status === 'pending') baseFilter.isVerified = false;
  if (status === 'verified') baseFilter.isVerified = true;
  const decoded = cursor.decode(before, status);
  const filter = decoded ? { $and: [baseFilter, { $or: [
    { createdAt: { $lt: decoded.createdAt } },
    { createdAt: decoded.createdAt, _id: { $lt: decoded.id } }
  ] }] } : baseFilter;
  const query = User.find(filter).sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1).select('_id email role isVerified createdAt').lean();
  if (!before && page > 1) query.skip((page - 1) * limit);
  const rows = await query;
  const hasMore = rows.length > limit;
  const pharmacies = hasMore ? rows.slice(0, limit) : rows;
  const total = !before && includeTotal !== 'false'
    ? await User.countDocuments(baseFilter) : undefined;
  return {
    items: pharmacies.map((user) => ({ id: user._id.toString(), email: user.email,
      role: user.role, isVerified: user.isVerified, createdAt: user.createdAt })),
    pagination: { page, limit, ...(total === undefined ? {} : { total }), hasMore,
      nextCursor: hasMore && pharmacies.length
        ? cursor.encode(pharmacies[pharmacies.length - 1], status) : null }
  };
};
module.exports = { list };
