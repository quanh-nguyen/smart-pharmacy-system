// Bộ câu hỏi MẪU để chạy thử hệ thống.
// ⚠ Nội dung y khoa chỉ là ví dụ, chưa được chuyên gia kiểm duyệt — không dùng cho người thật.
module.exports = function buildColdFlu({ paracetamol, loratadine, oresol }) {
  return {
    code: 'cam-cum',
    title: 'Cảm cúm, sốt (mẫu)',
    description: 'Dành cho người lớn có triệu chứng cảm cúm nhẹ.',
    questions: [
      { id: 'age_group', text: 'Bạn thuộc nhóm tuổi nào?', type: 'single', options: [
        { value: 'child', label: 'Dưới 12 tuổi' },
        { value: 'adult', label: '12–64 tuổi' },
        { value: 'elderly', label: 'Từ 65 tuổi' },
      ] },
      { id: 'pregnant', text: 'Bạn có đang mang thai hoặc cho con bú không?', type: 'boolean' },
      { id: 'breathing_difficulty', text: 'Bạn có khó thở hoặc đau ngực không?', type: 'boolean' },
      { id: 'fever', text: 'Bạn có sốt không?', type: 'boolean' },
      { id: 'temperature', text: 'Nhiệt độ cao nhất đo được (°C)?', type: 'number', required: false },
      { id: 'fever_days', text: 'Bạn đã sốt bao nhiêu ngày?', type: 'number', required: false },
      { id: 'symptoms', text: 'Bạn có những triệu chứng nào?', type: 'multi', required: false, options: [
        { value: 'runny_nose', label: 'Sổ mũi, hắt hơi' },
        { value: 'cough', label: 'Ho' },
        { value: 'sore_throat', label: 'Đau họng' },
        { value: 'headache', label: 'Đau đầu' },
        { value: 'diarrhea', label: 'Tiêu chảy' },
      ] },
    ],
    rules: [
      {
        id: 'red_breathing', priority: 10, redFlag: true,
        conditions: { all: [{ fact: 'breathing_difficulty', operator: 'equal', value: true }] },
        advice: 'Khó thở/đau ngực là dấu hiệu nguy hiểm. Hãy đến cơ sở y tế ngay hoặc gọi 115.',
      },
      {
        id: 'red_high_fever', priority: 10, redFlag: true,
        conditions: { any: [
          { fact: 'temperature', operator: 'greaterThanInclusive', value: 39.5 },
          { fact: 'fever_days', operator: 'greaterThanInclusive', value: 3 },
        ] },
        advice: 'Sốt cao hoặc kéo dài từ 3 ngày cần được bác sĩ thăm khám.',
      },
      {
        id: 'red_special_group', priority: 10, redFlag: true,
        conditions: { any: [
          { fact: 'pregnant', operator: 'equal', value: true },
          { fact: 'age_group', operator: 'in', value: ['child', 'elderly'] },
        ] },
        advice: 'Trẻ em, người cao tuổi, phụ nữ mang thai/cho con bú cần hỏi ý kiến bác sĩ trước khi dùng thuốc.',
      },
      {
        id: 'fever', priority: 5,
        conditions: { all: [{ fact: 'fever', operator: 'equal', value: true }] },
        suggestions: [{ drug: paracetamol, note: 'Hạ sốt, giảm đau. Không dùng quá liều ghi trên nhãn.' }],
        advice: 'Uống nhiều nước, nghỉ ngơi.',
      },
      {
        id: 'headache', priority: 4,
        conditions: { all: [{ fact: 'symptoms', operator: 'contains', value: 'headache' }] },
        suggestions: [{ drug: paracetamol, note: 'Giảm đau đầu.' }],
      },
      {
        id: 'runny_nose', priority: 3,
        conditions: { all: [{ fact: 'symptoms', operator: 'contains', value: 'runny_nose' }] },
        suggestions: [{ drug: loratadine, note: 'Giảm sổ mũi, hắt hơi.' }],
      },
      {
        id: 'diarrhea', priority: 3,
        conditions: { all: [{ fact: 'symptoms', operator: 'contains', value: 'diarrhea' }] },
        suggestions: [{ drug: oresol, note: 'Bù nước và điện giải.' }],
      },
    ],
  };
};
