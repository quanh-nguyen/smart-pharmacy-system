const fs = require('fs/promises');
const { Op } = require('sequelize');
const {
  sequelize, Prescription, PrescriptionItem, Order, Drug, Pharmacy,
} = require('../../models');
const AppError = require('../../utils/AppError');
const { sameId } = require('../../utils/schemas');
const { extractText } = require('./ocr.service');
const { parsePrescriptionText, matchDrugs } = require('./prescriptionParser');

const EDITABLE = ['ocr_done', 'failed'];
const DRUG_ATTRS = ['id', 'name', 'activeIngredient', 'strength', 'isPrescription'];

const clip = (s, n) => (s == null ? s : String(s).slice(0, n));

function toItemRow(prescriptionId, i) {
  return {
    prescriptionId,
    drugId: i.drugId || null,
    rawText: clip(i.rawText, 500),
    drugName: clip(i.drugName, 200),
    strength: clip(i.strength, 50),
    matchScore: i.matchScore,
    quantity: Math.min(Math.max(Number(i.quantity) || 1, 1), 10000),
    instructions: clip(i.instructions, 500),
  };
}

async function resolvePharmacyId(user) {
  if (user.pharmacyId) return user.pharmacyId;
  const p = await Pharmacy.findOne({ where: { ownerId: user.id }, attributes: ['id'] });
  return p ? String(p.id) : null;
}

// Ai được xem đơn thuốc: chủ đơn, admin, hoặc nhà thuốc nhận đơn hàng gắn đơn thuốc này
async function loadWithAccess(user, id) {
  const doc = await Prescription.findByPk(id);
  if (!doc) throw new AppError(404, 'Không tìm thấy đơn thuốc');
  if (user.role === 'admin') return doc;
  if (user.role === 'customer' && sameId(doc.customerId, user.id)) return doc;
  if (user.role === 'pharmacy') {
    const pharmacyId = await resolvePharmacyId(user);
    if (pharmacyId && (await Order.count({ where: { prescriptionId: doc.id, pharmacyId } }))) return doc;
  }
  throw new AppError(404, 'Không tìm thấy đơn thuốc');
}

function assertOwner(user, doc) {
  if (!sameId(doc.customerId, user.id)) throw new AppError(403, 'Chỉ chủ đơn thuốc được thao tác');
}

async function processOcr(id) {
  const doc = await Prescription.findByPk(id);
  if (!doc) return;
  await doc.update({ status: 'processing', errorMessage: null });
  try {
    const text = await extractText(doc.filePath, doc.fileMimeType);
    const parsed = parsePrescriptionText(text);
    const catalog = await Drug.findAll({ attributes: ['id', 'name', 'activeIngredient', 'strength'], raw: true });
    const items = matchDrugs(parsed.items, catalog).slice(0, 50);

    await sequelize.transaction(async (transaction) => {
      await PrescriptionItem.destroy({ where: { prescriptionId: doc.id }, transaction });
      await PrescriptionItem.bulkCreate(items.map((i) => toItemRow(doc.id, i)), { transaction });
      await doc.update(
        {
          ocrText: text,
          doctorName: clip(parsed.doctorName, 150),
          issuedAt: parsed.issuedAt,
          status: 'ocr_done',
          errorMessage: items.length ? null : 'Không nhận diện được dòng thuốc nào, vui lòng nhập tay.',
        },
        { transaction },
      );
    });
  } catch (err) {
    console.error(`OCR failed for prescription ${id}:`, err.message);
    await doc.update({
      status: 'failed',
      errorMessage: err instanceof AppError
        ? err.message
        : 'Không đọc được đơn thuốc. Vui lòng nhập tay hoặc tải ảnh rõ hơn.',
    });
  }
}

// OCR chạy nền, client gọi GET /:id để theo dõi trạng thái
function queueOcr(id) {
  setImmediate(() => processOcr(id).catch((err) => console.error(err)));
}

// Khi server khởi động lại, chạy tiếp các đơn đang dở
async function recoverStuckJobs() {
  const stuck = await Prescription.findAll({
    where: { status: { [Op.in]: ['uploaded', 'processing'] } },
    attributes: ['id'],
  });
  stuck.forEach((d) => queueOcr(d.id));
}

async function create(user, file) {
  if (!file) throw new AppError(400, 'Thiếu file đơn thuốc (field "file")');
  let doc;
  try {
    doc = await Prescription.create({
      customerId: user.id,
      filePath: file.path,
      fileOriginalName: clip(file.originalname, 255),
      fileMimeType: file.mimetype,
      fileSize: file.size,
    });
  } catch (err) {
    await fs.unlink(file.path).catch(() => {});
    throw err;
  }
  queueOcr(doc.id);
  return doc;
}

async function list(user, { page, limit, status }) {
  const where = user.role === 'admin' ? {} : { customerId: user.id };
  if (status) where.status = status;
  const { rows, count } = await Prescription.findAndCountAll({
    where,
    attributes: { exclude: ['ocrText'] },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });
  return { items: rows, total: count, page, limit };
}

async function get(user, id) {
  const doc = await loadWithAccess(user, id);
  return Prescription.findByPk(doc.id, {
    include: [{
      model: PrescriptionItem,
      as: 'items',
      include: [{ model: Drug, as: 'drug', attributes: DRUG_ATTRS }],
    }],
    order: [[{ model: PrescriptionItem, as: 'items' }, 'id', 'ASC']],
  });
}

async function getFile(user, id) {
  const doc = await loadWithAccess(user, id);
  return { path: doc.filePath, mimeType: doc.fileMimeType };
}

async function updateItems(user, id, items) {
  const doc = await loadWithAccess(user, id);
  assertOwner(user, doc);
  if (!EDITABLE.includes(doc.status)) {
    throw new AppError(409, `Không thể sửa đơn thuốc ở trạng thái "${doc.status}"`);
  }
  const drugIds = [...new Set(items.filter((i) => i.drugId).map((i) => i.drugId))];
  const drugs = drugIds.length ? await Drug.findAll({ where: { id: drugIds }, raw: true }) : [];
  const byId = new Map(drugs.map((d) => [String(d.id), d]));
  const missing = drugIds.filter((d) => !byId.has(String(d)));
  if (missing.length) throw new AppError(400, 'Có thuốc không tồn tại trong danh mục', { missing });

  const rows = items.map((i) => {
    const drug = i.drugId ? byId.get(String(i.drugId)) : null;
    return toItemRow(doc.id, {
      rawText: i.rawText,
      drugId: drug ? drug.id : null,
      drugName: i.drugName || drug?.name,
      strength: i.strength ?? drug?.strength,
      quantity: i.quantity,
      instructions: i.instructions,
      matchScore: drug ? 1 : 0, // người dùng đã tự chọn
    });
  });

  await sequelize.transaction(async (transaction) => {
    await PrescriptionItem.destroy({ where: { prescriptionId: doc.id }, transaction });
    await PrescriptionItem.bulkCreate(rows, { transaction });
    await doc.update({ status: 'ocr_done', errorMessage: null }, { transaction });
  });
  return get(user, id);
}

async function confirm(user, id) {
  const doc = await loadWithAccess(user, id);
  assertOwner(user, doc);
  if (doc.status !== 'ocr_done') {
    throw new AppError(409, `Chỉ xác nhận được đơn ở trạng thái "ocr_done" (hiện tại: "${doc.status}")`);
  }
  const items = await PrescriptionItem.findAll({ where: { prescriptionId: doc.id }, raw: true });
  if (!items.length) throw new AppError(400, 'Đơn thuốc chưa có dòng thuốc nào');
  const unmatched = items.filter((i) => !i.drugId).map((i) => i.drugName);
  if (unmatched.length) {
    throw new AppError(400, 'Hãy chọn thuốc tương ứng trong danh mục hoặc xóa các dòng chưa khớp', {
      unmatched,
    });
  }
  // Điều kiện status = 'ocr_done' tránh xác nhận 2 lần cùng lúc
  const [updated] = await Prescription.update(
    { status: 'confirmed', confirmedAt: new Date() },
    { where: { id: doc.id, status: 'ocr_done' } },
  );
  if (!updated) throw new AppError(409, 'Đơn thuốc vừa thay đổi, vui lòng tải lại');
  return get(user, id);
}

async function reprocess(user, id) {
  const doc = await loadWithAccess(user, id);
  assertOwner(user, doc);
  if (!EDITABLE.includes(doc.status)) {
    throw new AppError(409, `Không thể OCR lại đơn ở trạng thái "${doc.status}"`);
  }
  queueOcr(doc.id);
  return { id: doc.id, status: 'processing' };
}

async function remove(user, id) {
  const doc = await loadWithAccess(user, id);
  assertOwner(user, doc);
  if (await Order.count({ where: { prescriptionId: doc.id } })) {
    throw new AppError(409, 'Đơn thuốc đã gắn với đơn hàng, không thể xóa');
  }
  const { filePath } = doc;
  await doc.destroy(); // prescription_items bị xóa theo (ON DELETE CASCADE)
  await fs.unlink(filePath).catch(() => {});
}

module.exports = {
  create, list, get, getFile, updateItems, confirm, reprocess, remove,
  processOcr, recoverStuckJobs, resolvePharmacyId,
};
