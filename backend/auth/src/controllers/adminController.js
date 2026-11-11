const sessionService = require('../services/sessionService');
const pharmacyQueryService = require('../services/pharmacyQueryService');
const ApiError = require('../utils/ApiError');
const sendSuccess = require('../utils/sendSuccess');

const listPharmacies = async (req, res) => sendSuccess(res, 200, 'Danh sách nhà thuốc.',
  await pharmacyQueryService.list(req.validated.query));

const setAccountActive = async (req, res) => {
  if (req.user.id === req.params.id && req.body.isActive === false) {
    throw new ApiError(409, 'ADMIN không thể tự khóa chính mình.');
  }
  await sessionService.setAccountActiveStatus(req.params.id, req.body.isActive,
    req.securityOperation);
  return sendSuccess(res, 200, 'Đã cập nhật trạng thái tài khoản.');
};
module.exports = { listPharmacies, setAccountActive };
