const router = require('express').Router();
const c = require('./pharmacies.controller');
const { asyncHandler } = require('../../utils/helpers');
const { requireAdmin } = require('../../middlewares/auth');

// Cong khai
router.get('/', asyncHandler(c.list));
router.get('/nearby', asyncHandler(c.nearby)); // phai dat truoc '/:id'
router.get('/:id', asyncHandler(c.getById));

// Dang ky nha thuoc: de cong khai (nha thuoc tu dang ky tren web). Server tu dat trang thai `pending`
// va khong nhan owner_id tu client; khi co Auth thi lay chu so huu tu tai khoan dang nhap.
router.post('/', asyncHandler(c.create));

// Sua / vo hieu hoa nha thuoc: TAM THOI chi admin (khoa ADMIN_API_KEY).
// Khi co Auth + phan quyen thi doi thanh "admin hoac chu nha thuoc do".
router.put('/:id', requireAdmin, asyncHandler(c.update));
router.delete('/:id', requireAdmin, asyncHandler(c.remove));

module.exports = router;
