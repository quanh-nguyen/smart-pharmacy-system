// Nghe sự kiện từ module Orders và tạo thông báo cho đúng người.
const orderEvents = require('../../events/orderEvents');
const { Pharmacy } = require('../../models');
const { formatOrderCode } = require('../../models/Order');
const { notify, emitToUsers } = require('./notification.service');

const STATUS_TEXT = {
  confirmed: 'đã được nhà thuốc xác nhận',
  rejected: 'đã bị nhà thuốc từ chối',
  preparing: 'đang được chuẩn bị',
  delivering: 'đang được giao',
  completed: 'đã hoàn thành',
  cancelled: 'đã bị hủy',
};

async function pharmacyOwnerId(pharmacyId) {
  const p = await Pharmacy.findByPk(pharmacyId, { attributes: ['ownerId'] });
  return p ? String(p.ownerId) : null;
}

async function onCreated({ order }) {
  const ownerId = await pharmacyOwnerId(order.pharmacyId);
  await notify([ownerId], {
    type: 'order.created',
    title: 'Đơn hàng mới',
    message: `Bạn có đơn hàng mới #${formatOrderCode(order.id)}${order.prescriptionId ? ' (kèm đơn thuốc)' : ''}.`,
    data: { orderId: order.id, status: order.status },
  });
  emitToUsers([ownerId, order.customerId], 'order:updated', { orderId: order.id, status: order.status });
}

async function onStatusChanged({ order, to, actor, note }) {
  const ownerId = await pharmacyOwnerId(order.pharmacyId);
  const customerId = String(order.customerId);
  const code = formatOrderCode(order.id);
  const message = `Đơn hàng #${code} ${STATUS_TEXT[to] || `chuyển sang "${to}"`}${note ? `. Ghi chú: ${note}` : '.'}`;
  const payload = { type: `order.${to}`, title: 'Cập nhật đơn hàng', message, data: { orderId: order.id, status: to } };

  // Báo cho bên còn lại (người thao tác không cần nhận thông báo của chính mình)
  const actorId = String(actor.id);
  const recipients = [];
  if (actorId !== customerId) recipients.push(customerId);
  if (ownerId && actorId !== ownerId) recipients.push(ownerId);
  await notify(recipients, payload);

  emitToUsers([customerId, ownerId], 'order:updated', { orderId: order.id, status: to });
}

const safe = (fn) => (payload) => fn(payload).catch((err) => console.error('Notification error:', err));

let registered = false;
function registerOrderListeners() {
  if (registered) return;
  registered = true;
  orderEvents.on('created', safe(onCreated));
  orderEvents.on('statusChanged', safe(onStatusChanged));
}

module.exports = { registerOrderListeners };
