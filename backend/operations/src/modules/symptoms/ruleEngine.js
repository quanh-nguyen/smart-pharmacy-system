// Bộ máy luật nhỏ, cú pháp điều kiện giống json-rules-engine:
//   { all: [cond, ...] } | { any: [cond, ...] } | { not: cond }
//   cond = { fact: 'fever', operator: 'equal', value: true } hoặc một nhóm lồng nhau
// Viết tay để dễ kiểm soát, dễ test và chuyên gia/admin đọc được luật dạng JSON.
const AppError = require('../../utils/AppError');

const OPERATORS = {
  equal: (a, b) => a === b,
  notEqual: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  notIn: (a, b) => Array.isArray(b) && !b.includes(a),
  contains: (a, b) => Array.isArray(a) && a.includes(b),
  doesNotContain: (a, b) => Array.isArray(a) && !a.includes(b),
  containsAny: (a, b) => Array.isArray(a) && Array.isArray(b) && b.some((x) => a.includes(x)),
  lessThan: (a, b) => typeof a === 'number' && a < b,
  lessThanInclusive: (a, b) => typeof a === 'number' && a <= b,
  greaterThan: (a, b) => typeof a === 'number' && a > b,
  greaterThanInclusive: (a, b) => typeof a === 'number' && a >= b,
};

function isGroup(node) {
  return node && (Array.isArray(node.all) || Array.isArray(node.any) || node.not);
}

function evaluateCondition(node, facts) {
  if (Array.isArray(node.all)) return node.all.every((c) => evaluateCondition(c, facts));
  if (Array.isArray(node.any)) return node.any.some((c) => evaluateCondition(c, facts));
  if (node.not) return !evaluateCondition(node.not, facts);
  const op = Object.hasOwn(OPERATORS, node.operator) ? OPERATORS[node.operator] : null;
  if (!op) return false;
  const value = facts[node.fact];
  if (value === undefined) return false; // câu hỏi không bắt buộc bị bỏ trống -> điều kiện không thỏa
  return op(value, node.value);
}

// Kiểm tra cấu trúc luật trước khi duyệt; trả về danh sách lỗi
function validateConditions(node, factIds, path = 'conditions') {
  const errors = [];
  if (!node || typeof node !== 'object') return [`${path}: phải là object`];
  if (isGroup(node)) {
    if (node.all) node.all.forEach((c, i) => errors.push(...validateConditions(c, factIds, `${path}.all[${i}]`)));
    if (node.any) node.any.forEach((c, i) => errors.push(...validateConditions(c, factIds, `${path}.any[${i}]`)));
    if (node.not) errors.push(...validateConditions(node.not, factIds, `${path}.not`));
    if ((node.all && !node.all.length) || (node.any && !node.any.length)) errors.push(`${path}: nhóm rỗng`);
    return errors;
  }
  if (!factIds.has(node.fact)) errors.push(`${path}: fact "${node.fact}" không phải id câu hỏi nào`);
  if (!Object.hasOwn(OPERATORS, node.operator)) errors.push(`${path}: operator "${node.operator}" không hỗ trợ`);
  if (!('value' in node)) errors.push(`${path}: thiếu value`);
  return errors;
}

// Kiểm tra câu trả lời theo định nghĩa câu hỏi
function validateAnswers(questions, answers = {}) {
  const facts = {};
  const errors = [];
  for (const q of questions) {
    const v = answers[q.id];
    if (v === undefined || v === null || v === '') {
      if (q.required !== false) errors.push(`Thiếu câu trả lời cho "${q.text}"`);
      continue;
    }
    const optionValues = (q.options || []).map((o) => o.value);
    const ok =
      (q.type === 'boolean' && typeof v === 'boolean') ||
      (q.type === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
      (q.type === 'single' && optionValues.includes(v)) ||
      (q.type === 'multi' && Array.isArray(v) && v.every((x) => optionValues.includes(x)));
    if (!ok) errors.push(`Câu trả lời không hợp lệ cho "${q.text}"`);
    else facts[q.id] = v;
  }
  return { facts, errors };
}

// Trả về kết quả gợi ý (chưa lọc OTC — phần đó làm ở service vì cần DB)
function evaluateQuestionnaire(questionnaire, answers) {
  const { facts, errors } = validateAnswers(questionnaire.questions, answers);
  if (errors.length) throw new AppError(400, 'Câu trả lời không hợp lệ', { errors });

  const fired = [...questionnaire.rules]
    .sort((a, b) => (b.priority || 1) - (a.priority || 1))
    .filter((rule) => evaluateCondition(rule.conditions, facts));

  const redFlags = fired.filter((r) => r.redFlag);
  if (redFlags.length) {
    // Có dấu hiệu nguy hiểm: KHÔNG gợi ý thuốc, chỉ khuyên đi khám
    return {
      redFlag: true,
      matchedRules: redFlags.map((r) => r.id),
      advice: redFlags.map((r) => r.advice).filter(Boolean),
      suggestions: [],
    };
  }

  const seen = new Set();
  const suggestions = [];
  for (const rule of fired) {
    for (const s of rule.suggestions || []) {
      const key = String(s.drug);
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ drugId: s.drug, note: s.note, ruleId: rule.id });
    }
  }

  return {
    redFlag: false,
    matchedRules: fired.map((r) => r.id),
    advice: fired.map((r) => r.advice).filter(Boolean),
    suggestions,
  };
}

module.exports = { OPERATORS, evaluateCondition, validateConditions, validateAnswers, evaluateQuestionnaire };
