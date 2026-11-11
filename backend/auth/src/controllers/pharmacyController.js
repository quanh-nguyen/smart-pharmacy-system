const pharmacyService = require('../services/pharmacyService');
const sendSuccess = require('../utils/sendSuccess');

const setVerification = async (req, res) => {
  const pharmacy = await pharmacyService.setVerification(
    req.params.id,
    req.user.id,
    req.body.isVerified,
    req.id,
    req.body.reason
  );

  return sendSuccess(res, 200, 'Cập nhật trạng thái xác minh nhà thuốc thành công.', { pharmacy: pharmacy.toPublicJSON() });
};

const getVerificationHistory = async (req, res) => {
  const history = await pharmacyService.getVerificationHistory(
    req.params.id,
    req.validated.query
  );

  return sendSuccess(res, 200, 'Lấy lịch sử xác minh nhà thuốc thành công.', history);
};

const getWorkspace = async (_req, res) => {
  return sendSuccess(res, 200, 'Nhà thuốc đã được xác minh và có thể truy cập nghiệp vụ.', null);
};

module.exports = { setVerification, getVerificationHistory, getWorkspace };
