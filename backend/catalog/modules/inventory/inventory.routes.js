const router = require('express').Router();
const c = require('./inventory.controller');
const { asyncHandler } = require('../../utils/helpers');
const { requireAdmin } = require('../../middlewares/auth');

// Mount tai /api
router.get('/pharmacies/:pharmacyId/inventory', asyncHandler(c.listByPharmacy));
// Ghi kho: TAM THOI chi admin (ADMIN_API_KEY). Khi co Auth thi doi thanh "admin hoac chu nha thuoc do".
router.put('/pharmacies/:pharmacyId/inventory/:medicineId', requireAdmin, asyncHandler(c.upsert));
router.delete('/pharmacies/:pharmacyId/inventory/:medicineId', requireAdmin, asyncHandler(c.remove));
router.get('/medicines/:medicineId/availability', asyncHandler(c.availability));

module.exports = router;
