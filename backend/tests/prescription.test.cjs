const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../../docs/prescription.js'), 'utf8');
const parser = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('OCR extracts medicines and strengths, excluding patient details and dosage instructions', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines(`ĐƠN THUỐC
Họ tên: Nguyễn Văn A
Chẩn đoán: Viêm họng
1. Paracetamol 500 mg   SL: 10 viên
Uống 500 mg khi sốt
2) Loratadine 10mg x 10 viên
3. Vitamin C
SL: 20 viên
Ngày 12/11/2026
Bác sĩ: Nguyễn Văn B`), [
    { name: 'Paracetamol', strength: '500mg' },
    { name: 'Loratadine', strength: '10mg' },
    { name: 'Vitamin C', strength: '' },
  ]);
});

test('manual editing supports multiple separators, decimal strengths and duplicate removal', async () => {
  const { parseMedicineList } = await parser;
  assert.deepEqual(parseMedicineList('Paracetamol 500 mg, Vitamin C; Loratadine 0,5 mg\nPARACETAMOL 500mg'), [
    { name: 'Paracetamol', strength: '500mg' },
    { name: 'Vitamin C', strength: '' },
    { name: 'Loratadine', strength: '0.5mg' },
  ]);
});

test('an unreadable prescription does not invent a medicine list', async () => {
  const { parsePrescriptionMedicines, parseMedicineList } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('ĐƠN THUỐC\nHọ tên: Nguyễn Văn A\nNgày 12/11/2026'), []);
  assert.deepEqual(parsePrescriptionMedicines(''), []);
  assert.deepEqual(parseMedicineList(' , ; \n'), []);
});

test('stock matching respects exact medicine names and reviewed strengths', async () => {
  const { matchesMedicine } = await parser;
  const requested = { name: 'Paracetamol', strength: '500mg' };
  assert.equal(matchesMedicine(requested, { name: 'PARACETAMOL 500 mg' }), true);
  assert.equal(matchesMedicine(requested, { name: 'Paracetamol', strength: '500 mg' }), true);
  assert.equal(matchesMedicine(requested, { name: 'Paracetamol', strength: '250mg' }), false);
  assert.equal(matchesMedicine(requested, { name: 'Paracetamol Plus', strength: '500mg' }), false);
  assert.equal(matchesMedicine({ name: 'Vitamin C', strength: '' }, { name: 'Vitamin C 500mg' }), true);
});

test('printed prescription rows keep the brand/strength separate from classification and ingredients', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines(`ĐƠN THUỐC
1. Baciamin Plus (NT) 1 tỉ CFU (Saccharomyces boulardii) x 30 ngày = 60 Viên
2. Esapbe (NT) 40mg (Esomeprazole) x 30 ngày = 30 Viên
3. Alipro (NT) (THỰC PHẨM CHỨC NĂNG) x 30 ngày = 60 Viên
4. PROHEPATIS (NT) 200mg (Desmodium) x 30 ngày = 60 Viên
Khi thấy bất thường đến tái khám ngay.`), [
    { name: 'Baciamin Plus', strength: '1tỉCFU' },
    { name: 'Esapbe', strength: '40mg' },
    { name: 'Alipro', strength: '' },
    { name: 'PROHEPATIS', strength: '200mg' },
  ]);
});

test('compound strengths and release-form names are preserved', async () => {
  const { parsePrescriptionMedicines, matchesMedicine } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('(1) Metformin (SR) 500 mg\n2. Amoxicillin 500mg + 125mg\n3. Vitamin D3 1000 IU'), [
    { name: 'Metformin (SR)', strength: '500mg' },
    { name: 'Amoxicillin', strength: '500mg+125mg' },
    { name: 'Vitamin D3', strength: '1000IU' },
  ]);
  assert.equal(matchesMedicine({ name: 'Amoxicillin', strength: '500mg+125mg' },
    { name: 'Amoxicillin', strength: '500mg+62.5mg' }), false);
});

test('uncertain OCR readings of one row do not create a second invented medicine', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    { lines: [{ text: '1. Esapbe (NT) 40mg', confidence: 91 }, { text: '2. PROHEPATIS (NT) 200mg', confidence: 50 }] },
    { lines: [{ text: '1. Esapbe (NT) 40mg', confidence: 88 }, { text: '2. PROHEPATIS (NT) 200mg', confidence: 94 }] },
  ]);
  assert.deepEqual(items.map(({ name, strength, needsReview }) => ({ name, strength, needsReview })), [
    { name: 'Esapbe', strength: '40mg', needsReview: false },
    { name: 'PROHEPATIS', strength: '200mg', needsReview: false },
  ]);
  const conflict = selectPrescriptionReadings([
    { lines: [{ text: '1. Esapbe (NT) 40mg', confidence: 75 }] },
    { lines: [{ text: '1. Esapre (NT) 40mg', confidence: 90 }] },
  ]);
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].needsReview, true);
  assert.equal(conflict[0].name, 'Esapre');
});

test('a weak drug-name word or unreadable strength is flagged even with a confident surrounding line', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{ lines: [
    { text: '1. Esapbe (NT) 40mg', confidence: 94, words: [{ text: 'Esapbe', confidence: 40 }] },
    { text: '2. Alipro (NT) OUCPlr±MVCHỨCNANG)', confidence: 93 },
  ] }]);
  assert.equal(items[0].confidence, 40);
  assert.equal(items[0].needsReview, true);
  assert.equal(items[1].name, 'Alipro');
  assert.equal(items[1].strength, '');
  assert.equal(items[1].needsReview, true);
});

test('wrapped strengths attach to the numbered medicine without inventing ingredient rows', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines(`1. Amoxicillin (NT)
500 mg (Amoxicillin trihydrate)
2. Paracetamol 500mg
Hoạt chất Paracetamol 500mg
Uống 1 viên mỗi lần`), [
    { name: 'Amoxicillin', strength: '500mg' },
    { name: 'Paracetamol', strength: '500mg' },
  ]);
});

test('OCR quote artifacts and commas in numbering do not hide medicine rows', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines("‘3. Alipro (NT) (THỰC PHẨM CHỨC NĂNG)\n‘4, PROHEPATIS (NT) 200mg"), [
    { name: 'Alipro', strength: '' },
    { name: 'PROHEPATIS', strength: '200mg' },
  ]);
});

test('an unreadable row number does not silently remove a classified medicine', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{ text: '1. Paracetamol 500mg\nQA Alipro (NT) OUCPlr±MVCHỨCNANG)', confidence: 92 }]);
  assert.equal(items.length, 2);
  assert.equal(items[1].name, 'QA Alipro');
  assert.equal(items[1].needsReview, true);
});

test('equivalent CFU labels and microgram notation still match inventory without changing amounts', async () => {
  const { matchesMedicine } = await parser;
  assert.equal(matchesMedicine({ name: 'Probiotic', strength: '1tỉCFU' }, { name: 'Probiotic', strength: '1 tỷ CFU' }), true);
  assert.equal(matchesMedicine({ name: 'Probiotic', strength: '1tỉCFU' }, { name: 'Probiotic', strength: '2 tỷ CFU' }), false);
  assert.equal(matchesMedicine({ name: 'Vitamin D3', strength: '1000IU' }, { name: 'Vitamin D3', strength: '1000UI' }), true);
  assert.equal(matchesMedicine({ name: 'Vitamin B12', strength: '500mcg' }, { name: 'Vitamin B12', strength: '500µg' }), true);
});

test('complementary OCR passes retain every numbered medicine instead of only one pass', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    { text: '1. Paracetamol 500mg\n2. Loratadine 10mg', confidence: 95 },
    { text: '2. Loratadine 10mg\n3. Vitamin C 500mg', confidence: 94 },
  ]);
  assert.deepEqual(items.map(item => item.name), ['Paracetamol', 'Loratadine', 'Vitamin C']);
  assert.equal(items[2].needsReview, true);
});

test('a lost row number does not remove a medicine with a readable strength', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{ text: '1. Paracetamol 500mg\nLoratadine 10mg\n3. Metformin 500mg\nHoạt chất Metformin hydrochloride 500mg\nSau ăn uống 500mg', confidence: 95 }]);
  assert.deepEqual(items.map(item => item.name), ['Paracetamol', 'Loratadine', 'Metformin']);
  assert.equal(items[1].needsReview, true);
});

test('numbering without punctuation and multiple medicine rows on one OCR line are retained', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1 Paracetamol 500mg\n2 Loratadine 10mg\n10 viên'), [
    { name: 'Paracetamol', strength: '500mg' }, { name: 'Loratadine', strength: '10mg' },
  ]);
  assert.deepEqual(parsePrescriptionMedicines('1. Paracetamol 500mg   2. Loratadine 10mg'), [
    { name: 'Paracetamol', strength: '500mg' }, { name: 'Loratadine', strength: '10mg' },
  ]);
  assert.deepEqual(parsePrescriptionMedicines('01. Paracetamol 500mg   02. Loratadine 10mg'), [
    { name: 'Paracetamol', strength: '500mg' }, { name: 'Loratadine', strength: '10mg' },
  ]);
});

test('a wrapped medicine name and a wrapped compound strength are joined to their own rows', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Amoxicillin/\nclavulanic acid 500mg + 125mg\n2. Calcium 500mg +\n200 IU\nUống sau ăn'), [
    { name: 'Amoxicillin/ clavulanic acid', strength: '500mg+125mg' },
    { name: 'Calcium', strength: '500mg+200IU' },
  ]);
});

test('a wrapped CFU strength is not mistaken for a new row number', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Baciamin Plus (NT)\n1 tỉ CFU\n2. Paracetamol 500mg'), [
    { name: 'Baciamin Plus', strength: '1tỉCFU' }, { name: 'Paracetamol', strength: '500mg' },
  ]);
});

test('different printed rows with the same misread number are not collapsed', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{ lines: [
    { text: '1. Paracetamol 500mg', confidence: 94, bbox: {x0: 20, y0: 20, x1: 400, y1: 45} },
    { text: '1. Loratadine 10mg', confidence: 94, bbox: {x0: 20, y0: 140, x1: 400, y1: 165} },
  ] }]);
  assert.deepEqual(items.map(item => item.name), ['Paracetamol', 'Loratadine']);
  assert.ok(items.every(item => item.needsReview));
});

test('matching geometry aligns a row even when its number is lost without duplicating the medicine', async () => {
  const { selectPrescriptionReadings } = await parser;
  const bbox = {x0: 20, y0: 60, x1: 400, y1: 85};
  const items = selectPrescriptionReadings([
    { lines: [{text: '2. Loratadine 10mg', confidence: 94, bbox}] },
    { lines: [{text: 'Loratadine 1mg', confidence: 70, bbox}] },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].strength, '10mg');
  assert.equal(items[0].needsReview, true);
});

test('a complete readable name and strength are retained over a truncated high-confidence reading', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    {text:'1. Baciamin',confidence:96}, {text:'1. Baciamin Plus 1 tỉ CFU',confidence:92},
  ]);
  assert.equal(items[0].name,'Baciamin Plus');
  assert.equal(items[0].strength,'1tỉCFU');
  assert.equal(items[0].needsReview,true);
});

test('a weak single-letter medicine-name suffix is not treated as certain', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{lines:[{text:'1. Vitamin C 500mg',confidence:96,words:[{text:'Vitamin',confidence:98},{text:'C',confidence:35}]}]}]);
  assert.equal(items[0].confidence,35);
  assert.equal(items[0].needsReview,true);
});

test('agreement between independent readings outweighs one conflicting higher-confidence strength', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    {text:'1. Cetirizine 10mg',confidence:90}, {text:'1. Cetirizine 10mg',confidence:89}, {text:'1. Cetirizine 1mg',confidence:96},
  ]);
  assert.equal(items.length,1);
  assert.equal(items[0].strength,'10mg');
  assert.equal(items[0].needsReview,true);
});
