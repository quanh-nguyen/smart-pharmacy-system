// Máy trạng thái đơn hàng: ai được chuyển từ trạng thái nào sang trạng thái nào.
const AppError = require('../../utils/AppError');

const TRANSITIONS = {
  pending: {
    confirmed: ['pharmacy', 'admin'],
    rejected: ['pharmacy', 'admin'],
    cancelled: ['customer', 'admin'],
  },
  confirmed: {
    preparing: ['pharmacy', 'admin'],
    cancelled: ['pharmacy', 'admin'], // nhà thuốc hủy khi phát hiện vấn đề sau khi nhận
  },
  preparing: {
    delivering: ['pharmacy', 'admin'],
  },
  delivering: {
    completed: ['pharmacy', 'customer', 'admin'], // khách có thể xác nhận đã nhận hàng
  },
  completed: {},
  rejected: {},
  cancelled: {},
};

const STATUSES = Object.keys(TRANSITIONS);
const FINAL_STATUSES = STATUSES.filter((s) => Object.keys(TRANSITIONS[s]).length === 0);
// Chuyển sang các trạng thái này thì hoàn lại tồn kho đã giữ
const RESTOCK_STATUSES = ['rejected', 'cancelled'];

function allowedRoles(from, to) {
  if (!Object.hasOwn(TRANSITIONS, from)) return null;
  if (!Object.hasOwn(TRANSITIONS[from], to)) return null;
  return TRANSITIONS[from][to];
}

function canTransition(from, to, role) {
  const roles = allowedRoles(from, to);
  return Boolean(roles && roles.includes(role));
}

function assertTransition(from, to, role) {
  const roles = allowedRoles(from, to);
  if (!roles) throw new AppError(409, `Không thể chuyển đơn từ "${from}" sang "${to}"`);
  if (!roles.includes(role)) {
    throw new AppError(403, `Vai trò "${role}" không được chuyển đơn từ "${from}" sang "${to}"`);
  }
}

// Các bước tiếp theo mà vai trò này được phép làm (frontend dùng để hiện nút)
function nextStatuses(from, role) {
  return Object.entries(TRANSITIONS[from] || {})
    .filter(([, roles]) => roles.includes(role))
    .map(([to]) => to);
}

module.exports = {
  TRANSITIONS, STATUSES, FINAL_STATUSES, RESTOCK_STATUSES,
  canTransition, assertTransition, nextStatuses,
};
