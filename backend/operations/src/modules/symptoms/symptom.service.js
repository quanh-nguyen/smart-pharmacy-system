const { UniqueConstraintError } = require('sequelize');
const { sequelize, SymptomQuestionnaire, Drug } = require('../../models');
const AppError = require('../../utils/AppError');
const { checkSafety } = require('../../services/drugSafety');
const { evaluateQuestionnaire, validateConditions } = require('./ruleEngine');

const PUBLIC_ATTRS = ['id', 'code', 'version', 'title', 'description', 'questions', 'disclaimer', 'approvedAt'];
const DRUG_ATTRS = ['id', 'name', 'activeIngredient', 'strength', 'dosageForm', 'isPrescription'];

const ruleDrugIds = (rules = []) => [
  ...new Set(rules.flatMap((r) => (r.suggestions || []).map((s) => String(s.drug)))),
];

// ---------- Khách hàng ----------

async function listApproved() {
  return SymptomQuestionnaire.findAll({
    where: { status: 'approved' },
    attributes: ['id', 'code', 'version', 'title', 'description'],
    order: [['title', 'ASC']],
  });
}

async function getApproved(id) {
  const q = await SymptomQuestionnaire.findOne({ where: { id, status: 'approved' }, attributes: PUBLIC_ATTRS });
  if (!q) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  return q; // không trả luật cho khách
}

async function evaluate(user, id, answers) {
  const row = await SymptomQuestionnaire.findOne({ where: { id, status: 'approved' } });
  if (!row) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  const q = row.get({ plain: true });

  const result = evaluateQuestionnaire(q, answers);
  const base = { questionnaire: { id: q.id, code: q.code, version: q.version }, disclaimer: q.disclaimer };
  if (result.redFlag) return { ...base, ...result, warnings: [] };

  // Chốt chặn cuối: chỉ trả thuốc không kê đơn (OTC), kể cả khi luật lỡ chứa thuốc kê đơn
  const ids = result.suggestions.map((s) => s.drugId);
  const drugs = ids.length ? await Drug.findAll({ where: { id: ids }, attributes: DRUG_ATTRS, raw: true }) : [];
  const otc = new Map(drugs.filter((d) => !d.isPrescription).map((d) => [String(d.id), d]));
  const suggestions = result.suggestions
    .filter((s) => otc.has(String(s.drugId)))
    .map((s) => ({ ...s, drug: otc.get(String(s.drugId)) }));

  const warnings = await checkSafety(user.id, suggestions.map((s) => s.drugId));
  return { ...base, ...result, suggestions, warnings };
}

// ---------- Quản trị (soạn & kiểm duyệt) ----------

async function adminList({ code, status }) {
  const where = {};
  if (code) where.code = code;
  if (status) where.status = status;
  return SymptomQuestionnaire.findAll({
    where,
    attributes: ['id', 'code', 'version', 'title', 'status', 'createdBy', 'approvedBy', 'approvedAt', 'updatedAt'],
    order: [['code', 'ASC'], ['version', 'DESC']],
  });
}

// Trả kèm thông tin các thuốc được luật tham chiếu để admin dễ đọc
async function adminGet(id) {
  const row = await SymptomQuestionnaire.findByPk(id);
  if (!row) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  const q = row.get({ plain: true });
  const ids = ruleDrugIds(q.rules);
  q.drugs = ids.length
    ? await Drug.findAll({ where: { id: ids }, attributes: ['id', 'name', 'strength', 'isPrescription'], raw: true })
    : [];
  return q;
}

// Tạo bản nháp mới; nếu code đã tồn tại thì tăng version
async function create(user, data) {
  const latest = await SymptomQuestionnaire.max('version', { where: { code: data.code } });
  try {
    return await SymptomQuestionnaire.create({
      ...data,
      version: (latest || 0) + 1,
      status: 'draft',
      createdBy: user.id,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new AppError(409, 'Có người vừa tạo phiên bản mới cho bộ câu hỏi này, vui lòng thử lại');
    }
    throw err;
  }
}

async function update(id, data) {
  const q = await SymptomQuestionnaire.findByPk(id);
  if (!q) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  if (q.status !== 'draft') {
    throw new AppError(409, 'Chỉ sửa được bản nháp. Hãy tạo phiên bản mới từ bản đã duyệt.');
  }
  const { code, ...rest } = data; // không cho đổi code
  await q.update(rest);
  return q;
}

// Kiểm tra toàn bộ bộ câu hỏi trước khi duyệt. q: object thường { questions, rules }
async function collectApprovalErrors(q) {
  const errors = [];
  const questions = q.questions || [];
  const rules = q.rules || [];
  const questionIds = questions.map((x) => x.id);
  const factIds = new Set(questionIds);
  if (!questions.length) errors.push('Chưa có câu hỏi nào');
  if (factIds.size !== questionIds.length) errors.push('Có id câu hỏi bị trùng');
  questions.forEach((x) => {
    if (['single', 'multi'].includes(x.type) && !x.options?.length) errors.push(`Câu "${x.id}" thiếu lựa chọn`);
  });

  const ruleIds = new Set();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) errors.push(`Luật "${rule.id}" bị trùng id`);
    ruleIds.add(rule.id);
    errors.push(...validateConditions(rule.conditions, factIds, `rules.${rule.id}.conditions`));
    if (rule.redFlag && !rule.advice) errors.push(`Luật nguy hiểm "${rule.id}" phải có lời khuyên (advice)`);
    if (!rule.redFlag && !rule.suggestions?.length && !rule.advice) {
      errors.push(`Luật "${rule.id}" không có gợi ý thuốc lẫn lời khuyên`);
    }
  }

  const drugIds = ruleDrugIds(rules);
  if (drugIds.length) {
    const drugs = await Drug.findAll({ where: { id: drugIds }, attributes: ['id', 'name', 'isPrescription'], raw: true });
    const found = new Map(drugs.map((d) => [String(d.id), d]));
    for (const id of drugIds) {
      const d = found.get(id);
      if (!d) errors.push(`Thuốc id=${id} không tồn tại`);
      else if (d.isPrescription) errors.push(`"${d.name}" là thuốc kê đơn, không được gợi ý theo triệu chứng`);
    }
  }
  return errors;
}

async function approve(user, id) {
  const q = await SymptomQuestionnaire.findByPk(id);
  if (!q) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  if (q.status !== 'draft') throw new AppError(409, `Bộ câu hỏi đang ở trạng thái "${q.status}"`);

  const errors = await collectApprovalErrors(q.get({ plain: true }));
  if (errors.length) throw new AppError(400, 'Bộ câu hỏi chưa hợp lệ, không thể duyệt', { errors });

  // Mỗi code chỉ có 1 phiên bản đang dùng
  await sequelize.transaction(async (transaction) => {
    await SymptomQuestionnaire.update(
      { status: 'archived' },
      { where: { code: q.code, status: 'approved' }, transaction },
    );
    await q.update({ status: 'approved', approvedBy: user.id, approvedAt: new Date() }, { transaction });
  });
  return q;
}

async function archive(id) {
  const q = await SymptomQuestionnaire.findByPk(id);
  if (!q) throw new AppError(404, 'Không tìm thấy bộ câu hỏi');
  await q.update({ status: 'archived' });
  return q;
}

module.exports = {
  listApproved, getApproved, evaluate,
  adminList, adminGet, create, update, approve, archive, collectApprovalErrors,
};
