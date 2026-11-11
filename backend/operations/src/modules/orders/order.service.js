const { Op } = require('sequelize');
const {
  sequelize, Order, OrderItem, OrderStatusHistory, Prescription, PrescriptionItem,
  Drug, Pharmacy, Inventory, User,
} = require('../../models');
const AppError = require('../../utils/AppError');
const { sameId } = require('../../utils/schemas');
const orderEvents = require('../../events/orderEvents');
const { resolvePharmacyId } = require('../prescriptions/prescription.service');
const { assertTransition, nextStatuses, RESTOCK_STATUSES } = require('./orderStateMachine');

// Gộp các dòng trùng thuốc; sắp theo drugId để khóa dòng tồn kho theo thứ tự cố định (tránh deadlock)
function mergeItems(items) {
  const map = new Map();
  for (const { drugId, quantity } of items) {
    const key = String(drugId);
    map.set(key, (map.get(key) || 0) + quantity);
  }
  return [...map]
    .map(([drugId, quantity]) => ({ drugId, quantity }))
    .sort((a, b) => Number(a.drugId) - Number(b.drugId));
}

async function loadPrescription(user, prescriptionId) {
  const prescription = await Prescription.findByPk(prescriptionId, {
    include: [{ model: PrescriptionItem, as: 'items' }],
  });
  if (!prescription || !sameId(prescription.customerId, user.id)) {
    throw new AppError(404, 'Không tìm thấy đơn thuốc');
  }
  if (prescription.status !== 'confirmed') throw new AppError(400, 'Đơn thuốc chưa được xác nhận');
  return prescription;
}

async function create(user, input) {
  const pharmacy = await Pharmacy.findByPk(input.pharmacyId);
  if (!pharmacy) throw new AppError(404, 'Không tìm thấy nhà thuốc');
  if (!pharmacy.verified) throw new AppError(400, 'Nhà thuốc chưa được xác minh');

  const prescription = input.prescriptionId ? await loadPrescription(user, input.prescriptionId) : null;

  // Không gửi items -> lấy toàn bộ thuốc trong đơn thuốc
  let rawItems = input.items;
  if (!rawItems?.length) {
    rawItems = prescription.items.filter((i) => i.drugId).map((i) => ({ drugId: i.drugId, quantity: i.quantity }));
  }
  const items = mergeItems(rawItems);
  const drugIds = items.map((i) => i.drugId);

  const drugs = await Drug.findAll({ where: { id: drugIds }, raw: true });
  const drugsById = new Map(drugs.map((d) => [String(d.id), d]));
  const missing = drugIds.filter((id) => !drugsById.has(id));
  if (missing.length) throw new AppError(400, 'Có thuốc không tồn tại', { missing });

  // Thuốc kê đơn phải có trong đơn thuốc đã xác nhận
  const rxDrugs = drugs.filter((d) => d.isPrescription);
  if (rxDrugs.length) {
    if (!prescription) {
      throw new AppError(400, 'Đơn hàng có thuốc kê đơn, cần gắn đơn thuốc đã xác nhận', {
        prescriptionRequired: rxDrugs.map((d) => d.name),
      });
    }
    const allowed = new Set(prescription.items.map((i) => String(i.drugId)));
    const notInPrescription = rxDrugs.filter((d) => !allowed.has(String(d.id)));
    if (notInPrescription.length) {
      throw new AppError(400, 'Thuốc kê đơn không có trong đơn thuốc', {
        drugs: notInPrescription.map((d) => d.name),
      });
    }
  }

  // Một transaction: khóa dòng tồn kho (FOR UPDATE) -> kiểm tra -> trừ -> tạo đơn.
  // Lỗi ở bất kỳ bước nào thì rollback toàn bộ, không cần tự hoàn kho.
  const order = await sequelize.transaction(async (transaction) => {
    const inventories = await Inventory.findAll({
      where: { pharmacyId: pharmacy.id, drugId: drugIds },
      order: [['drugId', 'ASC']],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const invByDrug = new Map(inventories.map((inv) => [String(inv.drugId), inv]));

    const orderItems = [];
    for (const item of items) {
      const drug = drugsById.get(item.drugId);
      const inv = invByDrug.get(item.drugId);
      if (!inv || inv.quantity < item.quantity) {
        throw new AppError(409, `Nhà thuốc không đủ hàng: ${drug.name}`, {
          drugId: drug.id,
          available: inv ? inv.quantity : 0,
        });
      }
      await inv.decrement('quantity', { by: item.quantity, transaction });
      orderItems.push({
        drugId: drug.id,
        name: [drug.name, drug.strength].filter(Boolean).join(' '),
        quantity: item.quantity,
        unitPrice: inv.price, // chụp giá tại thời điểm đặt
        isPrescription: drug.isPrescription,
      });
    }

    const created = await Order.create(
      {
        customerId: user.id,
        pharmacyId: pharmacy.id,
        prescriptionId: prescription ? prescription.id : null,
        totalAmount: orderItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
        shippingAddress: input.shippingAddress,
        phone: input.phone,
        note: input.note,
      },
      { transaction },
    );
    await OrderItem.bulkCreate(orderItems.map((i) => ({ ...i, orderId: created.id })), { transaction });
    await OrderStatusHistory.create(
      { orderId: created.id, fromStatus: null, toStatus: 'pending', changedBy: user.id, role: user.role },
      { transaction },
    );
    return created;
  });

  // Chỉ phát sự kiện sau khi đã commit
  orderEvents.emit('created', { order, actor: user });
  return get(user, order.id);
}

async function scopeWhere(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'customer') return { customerId: user.id };
  const pharmacyId = await resolvePharmacyId(user);
  if (!pharmacyId) throw new AppError(403, 'Tài khoản chưa gắn với nhà thuốc nào');
  return { pharmacyId };
}

const PHARMACY_ATTRS = ['id', 'name', 'address', 'phone'];
const CUSTOMER_ATTRS = ['id', 'name'];

async function list(user, { page, limit, status, from, to }) {
  const where = await scopeWhere(user);
  if (status) where.status = status;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = from;
    if (to) where.createdAt[Op.lte] = to;
  }
  const { rows, count } = await Order.findAndCountAll({
    where,
    include: [
      { model: Pharmacy, as: 'pharmacy', attributes: PHARMACY_ATTRS },
      { model: User, as: 'customer', attributes: CUSTOMER_ATTRS },
    ],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });
  return { items: rows, total: count, page, limit };
}

async function get(user, id) {
  const order = await Order.findOne({
    where: { id, ...(await scopeWhere(user)) },
    include: [
      { model: OrderItem, as: 'items' },
      { model: Pharmacy, as: 'pharmacy', attributes: PHARMACY_ATTRS },
      { model: User, as: 'customer', attributes: CUSTOMER_ATTRS },
      {
        model: OrderStatusHistory,
        as: 'statusHistory',
        include: [{ model: User, as: 'changedByUser', attributes: CUSTOMER_ATTRS }],
      },
    ],
    order: [
      [{ model: OrderItem, as: 'items' }, 'id', 'ASC'],
      [{ model: OrderStatusHistory, as: 'statusHistory' }, 'id', 'ASC'],
    ],
  });
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng');
  return { ...order.toJSON(), allowedActions: nextStatuses(order.status, user.role) };
}

async function updateStatus(user, id, { status, note }) {
  const order = await Order.findOne({ where: { id, ...(await scopeWhere(user)) } });
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng');

  const from = order.status;
  assertTransition(from, status, user.role);
  if (status === 'rejected' && !note) throw new AppError(400, 'Cần nhập lý do từ chối');

  await sequelize.transaction(async (transaction) => {
    // Điều kiện status = from: hai người cập nhật cùng lúc thì chỉ một người thành công
    const [affected] = await Order.update(
      { status },
      { where: { id: order.id, status: from }, transaction },
    );
    if (!affected) throw new AppError(409, 'Đơn hàng vừa được cập nhật bởi người khác, vui lòng tải lại');

    await OrderStatusHistory.create(
      { orderId: order.id, fromStatus: from, toStatus: status, changedBy: user.id, role: user.role, note },
      { transaction },
    );

    // Từ chối / hủy -> hoàn lại tồn kho đã giữ khi tạo đơn
    if (RESTOCK_STATUSES.includes(status)) {
      const items = await OrderItem.findAll({ where: { orderId: order.id }, transaction });
      for (const item of items) {
        await Inventory.increment('quantity', {
          by: item.quantity,
          where: { pharmacyId: order.pharmacyId, drugId: item.drugId },
          transaction,
        });
      }
    }
  });

  await order.reload();
  orderEvents.emit('statusChanged', { order, from, to: status, actor: user, note });
  return get(user, order.id);
}

module.exports = { create, list, get, updateStatus, mergeItems };
