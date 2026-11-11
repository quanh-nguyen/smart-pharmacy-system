const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrescriptionText, matchDrugs } = require('../src/modules/prescriptions/prescriptionParser');

const SAMPLE = `ĐƠN THUỐC
Họ tên: Nguyễn Văn A   Tuổi: 30
Chẩn đoán: Viêm họng cấp
1. Amoxicilin 500mg      SL: 20 viên
   Ngày uống 2 lần, mỗi lần 1 viên
2) Paracetamol 500 mg x 10 viên
   Uống khi sốt trên 38.5 độ
3. Alpha choay
   SL: 6 viên
Hà Nội, ngày 12 tháng 10 năm 2026
Bác sĩ khám bệnh: Trần Thị B`;

const CATALOG = [
  { id: 'amox', name: 'Amoxicillin', activeIngredient: 'Amoxicillin', strength: '500mg' },
  { id: 'para', name: 'Paracetamol', activeIngredient: 'Paracetamol', strength: '500mg' },
  { id: 'alpha', name: 'Alphachoay', activeIngredient: 'Chymotrypsin', strength: '4.2mg' },
  { id: 'lora', name: 'Loratadine', activeIngredient: 'Loratadine', strength: '10mg' },
];

test('tách được dòng thuốc, hàm lượng, số lượng, cách dùng', () => {
  const r = parsePrescriptionText(SAMPLE);
  assert.equal(r.items.length, 3);
  assert.deepEqual(
    r.items.map((i) => [i.drugName, i.strength, i.quantity]),
    [['Amoxicilin', '500mg', 20], ['Paracetamol', '500mg', 10], ['Alpha choay', undefined, 6]],
  );
  assert.match(r.items[0].instructions, /2 lần/);
});

test('đọc được tên bác sĩ và ngày kê', () => {
  const r = parsePrescriptionText(SAMPLE);
  assert.equal(r.doctorName, 'Trần Thị B');
  assert.equal(r.issuedAt.toISOString().slice(0, 10), '2026-10-12');
});

test('so khớp gần đúng với danh mục, chịu được lỗi chính tả OCR', () => {
  const items = matchDrugs(parsePrescriptionText(SAMPLE).items, CATALOG);
  assert.deepEqual(items.map((i) => i.drugId), ['amox', 'para', 'alpha']);
  assert.ok(items.every((i) => i.matchScore >= 0.6));
});

test('tên không có trong danh mục thì drug = null', () => {
  const [item] = matchDrugs([{ drugName: 'Xyzabc', quantity: 1 }], CATALOG);
  assert.equal(item.drugId, null);
});

test('văn bản rỗng không lỗi', () => {
  assert.deepEqual(parsePrescriptionText('').items, []);
});
