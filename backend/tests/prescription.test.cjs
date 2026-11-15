const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../../docs/prescription.js'), 'utf8');
const parser = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const printedLayouts = JSON.parse(fs.readFileSync(require.resolve('../../tests/fixtures/printed-prescription-layouts.json'), 'utf8'));

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

test('document numbers, addresses, clinic hours and OCR headings are excluded before medicine selection', async () => {
  const { parsePrescriptionMedicines } = await parser;
  const items = parsePrescriptionMedicines(`1. LL SỞ Y TẾ TP.HỒ CHÍ MINH SỐ hồ sơ: 70180.140717744 955
2. PON THUOC
1. YESOM 40 40mg
2. SUCRATE GEL (Sucralfate 1g)
3. ARTHUR (Trimebutine 200)
4. PAPAZE (magnesi aluminometasilicate)
5. BIOCID MH 3.5g + 2g
6. DIGLUMISAN (L-Arginine Hydrochloride 1000mg)
78 Đường Giải Phóng, Phương Mai, Đống Đa, Hà Nội
7. no 78 Đường Giải Phóng
8. Đường Giải Phóng
9. đến thứ 6
10. Thứ 7
11. Chủ nhật (từ 7h30 đến 16h30)
12. Hotline: 0901234567
13. Số thẻ BHYT: 123456789012
14. Người bệnh: Nguyễn Văn A
15. Tái khám sau 30 ngày
76 Đ. Giải Phóng, P. Phương Mai, Q. Đống Đa
16. TP. Hồ Chí Minh
17. Đ/C: 78 Giải Phóng`);
  assert.deepEqual(items.map(item => item.name.split(/[ (]/)[0]), ['YESOM', 'SUCRATE', 'ARTHUR', 'PAPAZE', 'BIOCID', 'DIGLUMISAN']);
  assert.equal(items[1].strength, '1g');
  assert.equal(items[4].strength, '3.5g+2g');
  assert.equal(items[5].strength, '1000mg');
});

test('isolated OCR symbols, numeric codes and damaged text do not become medicines', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([{lines:[
    {text:'1. Etoricoxib(Roticox 90mg)',confidence:94},
    {text:'2. Pregabalin(Lyrica 75mg)',confidence:94},
    {text:'3. Lansoprazole 30mg',confidence:94},
    {text:'9. 8888.66 dễ dược hi',confidence:80},
    {text:'α =. 10g',confidence:50},
    {text:'8. n¤',confidence:65},
    {text:'. mg)(Viartril- S 1500mg',confidence:55},
    {text:'Mecobalamin ĐO CTGUN in Nhi co hả min CD SG! 1500mcg',confidence:55},
    {text:'Cophemccongdin NỎ TƯ NgU 2g',confidence:45,words:[
      {text:'Cophemccongdin',confidence:22},{text:'NỎ',confidence:12},{text:'TƯ',confidence:20},{text:'NgU',confidence:18},
    ]},
  ]}]);
  assert.deepEqual(items.map(item => item.name), ['Etoricoxib (Roticox)', 'Pregabalin (Lyrica)', 'Lansoprazole']);
});

test('a damaged row prefix is cleaned while its medicine and exact strength survive', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    {text:'đề \\2. SUCRATE GEL (Sucralfate 1g)',confidence:86},
    {text:'2. SUCRATE GEL (Sucralfate 1g)',confidence:94},
  ]);
  assert.equal(items.length,1);
  assert.equal(items[0].name,'SUCRATE GEL (Sucralfate)');
  assert.equal(items[0].strength,'1g');
});

test('formatting variants and repeated ingredient notes are merged without merging strengths or release forms', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    {text:'1. Mecobalamin (methylcobalamin) 1500mcg\n2. Metformin (SR) 500mg\n3. Metformin 500mg\n4. Mecobalamin 500mcg',confidence:94},
    {text:'Mecobalamin(methylcobalamin)(Methylcobalamin Capsules 1500mcg)\nMetformin (SR) 500mg\nMetformin 500mg\nMecobalamin 500mcg',confidence:91},
  ]);
  assert.equal(items.length,4);
  assert.equal(items.filter(item=>item.strength==='1500mcg').length,1);
  assert.equal(items.filter(item=>item.name.startsWith('Metformin')).length,2);
  assert.equal(items.filter(item=>item.name==='Mecobalamin' && item.strength==='500mcg').length,1);
});

test('unknown medicine names and traditional medicines survive document filtering', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Newbrand XR 25mg\n2. Hoạt huyết dưỡng não\n3. Metformin (SR) 500mg\n4. 5-HTP 100mg\n5. 5-FU 50mg\n6. Huyết áp Vương 500mg\n7. Đường Glucose 5%'),[
    {name:'Newbrand XR',strength:'25mg'}, {name:'Hoạt huyết dưỡng não',strength:''},
    {name:'Metformin (SR)',strength:'500mg'}, {name:'5-HTP',strength:'100mg'}, {name:'5-FU',strength:'50mg'},
    {name:'Huyết áp Vương',strength:'500mg'}, {name:'Đường Glucose',strength:'5%'},
  ]);
});

test('ingredient commas remain inside one medicine while user-entered separators still work', async () => {
  const { parseMedicineList } = await parser;
  assert.deepEqual(parseMedicineList('Calcium (citrate, carbonate) 500mg, Vitamin C 0,5g; Loratadine 10mg'),[
    {name:'Calcium (citrate, carbonate)',strength:'500mg'}, {name:'Vitamin C',strength:'0.5g'}, {name:'Loratadine',strength:'10mg'},
  ]);
});

test('different parenthetical ingredients and brands remain separate medicines', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items = selectPrescriptionReadings([
    {text:'1. Calcium (citrate) 500mg\n2. Calcium (citrate + carbonate) 500mg\n3. Etoricoxib (Roticox) 90mg\n4. Etoricoxib (Arcoxia) 90mg',confidence:94},
    {text:'Calcium (citrate) 500mg\nCalcium (citrate + carbonate) 500mg\nEtoricoxib (Roticox) 90mg\nEtoricoxib (Arcoxia) 90mg',confidence:91},
  ]);
  assert.equal(items.length,4);
});

test('a medicine fused onto a document field is recovered before document filtering', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('Số hồ sơ: 70180   1. Paracetamol 500mg\n2. Vitamin C 500mg   3. Hotline: 0901234567'),[
    {name:'Paracetamol',strength:'500mg'},{name:'Vitamin C',strength:'500mg'},
  ]);
});

test('tidied OCR parentheses still match stock without substituting brands or release forms', async () => {
  const { matchesMedicine } = await parser;
  const requested = {name:'Etoricoxib (Roticox)',strength:'90mg'};
  assert.equal(matchesMedicine(requested,{name:'Etoricoxib(Roticox 90mg)'}),true);
  assert.equal(matchesMedicine(requested,{name:'Etoricoxib (Arcoxia) 90mg'}),false);
  assert.equal(matchesMedicine({name:'Metformin (SR)',strength:'500mg'},{name:'Metformin 500mg'}),false);
});

test('noisy composition descriptions are removed without inventing a missing compound unit', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items=selectPrescriptionReadings([{text:'1. Glucosamin (dưới dạng Cry: mg)(Viartril- S 1500mg)\n2. BIOCID MH 3.5+ 2g',confidence:95}]);
  assert.equal(items[0].name,'Glucosamin (Viartril- S)');
  assert.equal(items[0].strength,'1500mg');
  assert.equal(items[1].name,'BIOCID MH 3.5+');
  assert.equal(items[1].strength,'2g');
  assert.equal(items[1].needsReview,true);
});

for (const fixture of printedLayouts) test(`printed layout: ${fixture.id}`, async () => {
  const { parsePrescriptionMedicines, medicineLabel } = await parser;
  assert.deepEqual(parsePrescriptionMedicines(fixture.text).map(medicineLabel),fixture.expected);
});

test('damaged slash numbering is recovered instead of displaying a second medicine with a junk prefix', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const items=selectPrescriptionReadings([
    {text:'$44 1/ Cetirizine 10mg (Cetimed 10mg)\nA 3/ Thymomodulin 80mg (Rolspain 80mg)',confidence:80},
    {text:'1/ Cetirizine 10mg (Cetimed 10mg)\n3/ Thymomodulin 80mg (Rolspain 80mg)',confidence:94},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Cetirizine 10mg','Thymomodulin 80mg']);
});

test('cleaning stray prefixes preserves both digits of row numbers', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items=selectPrescriptionReadings([{text:'9. Vitamin C 500mg\n10. Vitamin D3 1000IU\n$44 12/ Loratadine 10mg',confidence:94}]);
  assert.deepEqual(items.map(item=>item.rowNumber),[9,10,12]);
});

test('a sparse reading of a printed alias stays attached to its numbered medicine', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const items=selectPrescriptionReadings([
    {text:'1/ Cetirizine 10mg (Cetimed 10mg)\n3/ Thymomodulin 80mg (Rolspain 80mg)',confidence:82},
    {text:'Cetirizine 10mg\nCetimed 10mg\nRolspain 80mg',confidence:95},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Cetirizine 10mg','Thymomodulin 80mg']);
});

test('aliases are consolidated even when the sparse pass arrives before the full numbered row', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const items=selectPrescriptionReadings([
    {text:'Cetirizine 10mg\nCetimed 10mg\nRolspain 80mg',confidence:95},
    {text:'1/ Cetirizine 10mg (Cetimed 10mg)\n3/ Thymomodulin 80mg (Rolspain 80mg)',confidence:82},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Cetirizine 10mg','Thymomodulin 80mg']);
});

test('an alias explicitly prescribed on a separate numbered row is not discarded', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const items=selectPrescriptionReadings([
    {text:'1/ Cetirizine 10mg (Cetimed 10mg)\n2/ Cetimed 10mg',confidence:95},
    {text:'Cetirizine 10mg\nCetimed 10mg',confidence:94},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Cetirizine 10mg','Cetimed 10mg']);
  const later=selectPrescriptionReadings([
    {text:'1/ Cetirizine 10mg (Cetimed 10mg)',confidence:95},
    {text:'Cetimed 10mg',confidence:94},
    {text:'2/ Cetimed 10mg',confidence:94},
  ]);
  assert.deepEqual(later.map(medicineLabel),['Cetirizine 10mg','Cetimed 10mg']);
});

test('a medicine merged onto its section heading remains readable', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('Thuốc điều trị: 1/ Cetirizine 10mg (Cetimed 10mg)'),[{name:'Cetirizine',strength:'10mg'}]);
});

test('partial OCR boxes contained in a numbered medicine row do not create extra drugs', async () => {
  const { selectPrescriptionReadings } = await parser;
  const items=selectPrescriptionReadings([
    {lines:[{text:'4/ Betamethason Dipropionate (Lotusalic 15g)',confidence:85,bbox:{x0:20,y0:400,x1:600,y1:430}}]},
    {lines:[{text:'pionate (Lotusalic 15g)',confidence:92,bbox:{x0:350,y0:402,x1:595,y1:429}}]},
  ]);
  assert.equal(items.length,1);
  assert.equal(items[0].name,'Betamethason Dipropionate (Lotusalic)');
});

test('vital signs and advice fragments are excluded even when OCR gives them false row numbers or units', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Sinh hiệu: HA: 13380 mmig LV 82 lần phút T: 3640 oC CN 68.00kg\n2. CN 68.00kg\n3. Khám the\n4. hoặc liên hệ\n5. đến bệnh viện khám lại'),[]);
});

test('short OCR rule fragments need medicine evidence while drug codes and release forms survive', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('7. EE\n8. AC 25mg\n9. Metformin [SR] 500mg'),[
    {name:'AC',strength:'25mg'},{name:'Metformin (SR)',strength:'500mg'},
  ]);
});

test('medicine-section bounds from a full reading also exclude sparse footer fragments', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const line=(text,y0,y1)=>({text,confidence:95,bbox:{x0:20,y0,x1:600,y1}});
  const items=selectPrescriptionReadings([
    {lines:[line('Sinh hiệu: HA 133/80 CN 68kg',100,120),line('Chỉ định dùng thuốc:',180,200),line('1. Althax [KDNT] 120mg',240,260),line('Lời dặn của bác sĩ:',500,520)]},
    {lines:[line('CN 68.00kg',125,145),line('Althax 120mg',240,260),line('7. hé. gan',550,570),line('8. hoặc liên hệ',590,610)]},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Althax 120mg']);
});

test('OCR date signatures and prose fragments do not become extra medicines', async () => {
  const { selectPrescriptionReadings, medicineLabel, parseMedicineList } = await parser;
  const text=`1. Clealine 50mg
2. Ozapex 5mg
3. Devodil 50mg
4. Grandaxin 50mg
5. Ganlotus
6. Pengatin
7. Eres ơi b5G
8. Hồ Nội, Ngày 09 Thing 10 Nom 2021`;
  const medicines=selectPrescriptionReadings([{text,confidence:94}]);
  const labels=medicines.map(medicineLabel);
  assert.deepEqual(labels,['Clealine 50mg','Ozapex 5mg','Devodil 50mg','Grandaxin 50mg','Ganlotus','Pengatin']);
  assert.deepEqual(parseMedicineList(labels.join('\n')).map(medicineLabel),labels);
});

test('signature dates with damaged month/year labels are excluded without a place-name blacklist', async () => {
  const { parsePrescriptionMedicines } = await parser;
  for (const footer of ['Hồ Nội, Ngày 09 Thing 10 Nom 2021','Đà Nẵng, ngày 09 tháng 10 năm 2021',
    '09 Thing 10 Nom 2021','Ngày09Thing10Nom2021','09/10/2021','2021-10-09','9. Thành phố khác, ngày 09 thàng 10 nãm 2021']) {
    assert.deepEqual(parsePrescriptionMedicines(footer),[],footer);
  }
});

test('a footer found in one reading also removes isolated city/date fragments in other readings', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const line=(text,y)=>({text,confidence:94,bbox:{x0:20,y0:y,x1:600,y1:y+20}});
  const items=selectPrescriptionReadings([
    {lines:[line('1. Grandaxin 50mg',100),line('2. Ganlotus',160),line('3. Pengatin',220),line('Hồ Nội, Ngày 09 Thing 10 Nom 2021',350)]},
    {lines:[line('1. Grandaxin 50mg',100),line('2. Ganlotus',160),line('3. Pengatin',220),line('7. Hồ Nội',350),line('8. Ngày 09 Thing 10 Nom 2021',380)]},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Grandaxin 50mg','Ganlotus','Pengatin']);
  const nameOnly=selectPrescriptionReadings([
    {lines:[line('1. Ganlotus',100),line('2. Pengatin',160),line('Hồ Nội, Ngày 09 Thing 10 Nom 2021',350)]},
    {lines:[line('1. Ganlotus',100),line('2. Pengatin',160),line('9. Chữ cuối trang 5g',400)]},
  ]);
  assert.deepEqual(nameOnly.map(medicineLabel),['Ganlotus','Pengatin']);
});

test('text-only readings use the same-image date signature to exclude a detached place fragment', async () => {
  const { selectPrescriptionReadings, medicineLabel } = await parser;
  const items=selectPrescriptionReadings([
    {text:'1. Ganlotus\n2. Pengatin\nHồ Nội, Ngày 09 Thing 10 Nom 2021',confidence:94},
    {text:'1. Ganlotus\n2. Pengatin\n8. Hồ Nội',confidence:93},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Ganlotus','Pengatin']);
});

test('document dates fused onto a medicine line preserve the medicine before the footer', async () => {
  const { parsePrescriptionMedicines, selectPrescriptionReadings, medicineLabel } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Grandaxin 50mg   Hồ Nội, Ngày 09 Thing 10 Nom 2021'),[{name:'Grandaxin',strength:'50mg'}]);
  assert.deepEqual(parsePrescriptionMedicines('1. Pengatin   Hồ Nội, Ngày 09 Thing 10 Nom 2021'),[{name:'Pengatin',strength:''}]);
  const items=selectPrescriptionReadings([
    {text:'1. Pengatin   Hồ Nội, Ngày 09 Thing 10 Nom 2021',confidence:94},
    {text:'1. Pengatin\n8. Hồ Nội',confidence:93},
  ]);
  assert.deepEqual(items.map(medicineLabel),['Pengatin']);
});

test('medicine names, concentrations and treatment dates do not truncate later medicines', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Vitamin D3 1000IU\nNgày 09/10/2021 bắt đầu uống theo hướng dẫn\n2. Vitamin B12 500mcg\n3. Newbrand 5mg + 10mg\n4. Hoạt huyết dưỡng não'),[
    {name:'Vitamin D3',strength:'1000IU'},{name:'Vitamin B12',strength:'500mcg'},
    {name:'Newbrand',strength:'5mg+10mg'},{name:'Hoạt huyết dưỡng não',strength:''},
  ]);
});

test('dates above the first medicine and a structured multiline OCR record preserve medicine rows', async () => {
  const { parsePrescriptionMedicines, selectPrescriptionReadings, medicineLabel } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('Thuốc điều trị:\nNgày 09 tháng 10 năm 2021\n1. Ganlotus\n2. Pengatin').map(medicineLabel),['Ganlotus','Pengatin']);
  const items=selectPrescriptionReadings([{lines:[{text:'1. Ganlotus\n2. Pengatin\nHồ Nội, Ngày 09 Thing 10 Nom 2021',confidence:94,bbox:{x0:20,y0:100,x1:600,y1:400}}]}]);
  assert.deepEqual(items.map(medicineLabel),['Ganlotus','Pengatin']);
});

test('a deaccented interjection plus a damaged amount is prose, while names and vitamin codes survive', async () => {
  const { parsePrescriptionMedicines, medicineLabel } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Eres oi b5G\n2. Newbrand OI 10mg\n3. Oil B5 5g\n4. Vitamin B12 500mcg').map(medicineLabel),[
    'Newbrand OI 10mg','Oil B5 5g','Vitamin B12 500mcg',
  ]);
});

test('advice appended after the amount does not remove the actual medicine', async () => {
  const { parsePrescriptionMedicines } = await parser;
  assert.deepEqual(parsePrescriptionMedicines('1. Vitamin C 500mg (không dùng thuốc này khi chưa hỏi bác sĩ)\n2. Grandaxin 50mg Không được tự tăng liều'),[
    {name:'Vitamin C',strength:'500mg'},{name:'Grandaxin',strength:'50mg'},
  ]);
});
