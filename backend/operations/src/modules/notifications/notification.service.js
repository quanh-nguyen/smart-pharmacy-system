const { Notification } = require('../../models');
const AppError = require('../../utils/AppError');

let io = null;
function setIo(instance) {
  io = instance;
}

function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const id of new Set(userIds.filter(Boolean).map(String))) io.to(`user:${id}`).emit(event, payload);
}

// Lưu DB + đẩy realtime
async function notify(userIds, { type, title, message, data = {} }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return [];
  const docs = await Notification.bulkCreate(
    ids.map((userId) => ({ userId, type, title, message: String(message).slice(0, 1000), data })),
  );
  if (io) docs.forEach((doc) => io.to(`user:${doc.userId}`).emit('notification:new', doc.toJSON()));
  return docs;
}

async function list(userId, { page, limit, unread }) {
  const where = { userId };
  if (unread) where.readAt = null;
  const [{ rows, count }, unreadCount] = await Promise.all([
    Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      offset: (page - 1) * limit,
      limit,
    }),
    Notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows, total: count, unreadCount, page, limit };
}

async function unreadCount(userId) {
  return { unreadCount: await Notification.count({ where: { userId, readAt: null } }) };
}

async function markRead(userId, id) {
  const doc = await Notification.findOne({ where: { id, userId } });
  if (!doc) throw new AppError(404, 'Không tìm thấy thông báo');
  if (!doc.readAt) await doc.update({ readAt: new Date() });
  return doc;
}

async function markAllRead(userId) {
  const [updated] = await Notification.update({ readAt: new Date() }, { where: { userId, readAt: null } });
  return { updated };
}

module.exports = { setIo, emitToUsers, notify, list, unreadCount, markRead, markAllRead };
