// ⚠ ĐIỂM TÍCH HỢP với module "Cảnh báo dị ứng / tương tác thuốc" của thành viên khác.
// Thay phần thân hàm bằng lời gọi tới service/API thật khi có.
// Trả về danh sách cảnh báo: [{ drugId, type: 'allergy' | 'interaction', message }]
async function checkSafety(/* customerId, drugIds */) {
  return [];
}

module.exports = { checkSafety };
