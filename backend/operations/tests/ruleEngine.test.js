const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateQuestionnaire, validateConditions } = require('../src/modules/symptoms/ruleEngine');
const buildColdFlu = require('../scripts/sampleQuestionnaire');

const Q = buildColdFlu({ paracetamol: 'para', loratadine: 'lora', oresol: 'ors' });
const base = { age_group: 'adult', pregnant: false, breathing_difficulty: false, fever: false };

test('sốt + sổ mũi -> gợi ý paracetamol và loratadine, không trùng lặp', () => {
  const r = evaluateQuestionnaire(Q, { ...base, fever: true, temperature: 38.2, symptoms: ['runny_nose', 'headache'] });
  assert.equal(r.redFlag, false);
  assert.deepEqual(r.suggestions.map((s) => s.drugId), ['para', 'lora']);
});

test('khó thở -> red flag, không gợi ý thuốc', () => {
  const r = evaluateQuestionnaire(Q, { ...base, breathing_difficulty: true, fever: true });
  assert.equal(r.redFlag, true);
  assert.deepEqual(r.suggestions, []);
  assert.ok(r.advice.length > 0);
});

test('sốt kéo dài 3 ngày -> red flag', () => {
  const r = evaluateQuestionnaire(Q, { ...base, fever: true, fever_days: 3 });
  assert.equal(r.redFlag, true);
});

test('trẻ em hoặc mang thai -> red flag', () => {
  assert.equal(evaluateQuestionnaire(Q, { ...base, age_group: 'child', fever: true }).redFlag, true);
  assert.equal(evaluateQuestionnaire(Q, { ...base, pregnant: true }).redFlag, true);
});

test('thiếu câu bắt buộc hoặc sai kiểu -> lỗi 400', () => {
  assert.throws(() => evaluateQuestionnaire(Q, { age_group: 'adult' }), { status: 400 });
  assert.throws(() => evaluateQuestionnaire(Q, { ...base, fever: 'yes' }), { status: 400 });
  assert.throws(() => evaluateQuestionnaire(Q, { ...base, symptoms: ['abc'] }), { status: 400 });
});

test('không triệu chứng -> không gợi ý gì', () => {
  const r = evaluateQuestionnaire(Q, base);
  assert.equal(r.redFlag, false);
  assert.deepEqual(r.suggestions, []);
});

test('validateConditions bắt fact/operator sai', () => {
  const facts = new Set(Q.questions.map((q) => q.id));
  for (const rule of Q.rules) assert.deepEqual(validateConditions(rule.conditions, facts), []);
  const errors = validateConditions({ all: [{ fact: 'nope', operator: 'like', value: 1 }] }, facts);
  assert.equal(errors.length, 2);
});
