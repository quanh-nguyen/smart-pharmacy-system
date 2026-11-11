const router = require('express').Router();
const c = require('./medicines.controller');
const { asyncHandler } = require('../../utils/helpers');
const { requireAdmin } = require('../../middlewares/auth');

router.get('/', asyncHandler(c.list));
router.get('/categories', asyncHandler(c.categories)); // phai dat truoc '/:id'
router.get('/:id/alternatives', asyncHandler(c.alternatives));
router.get('/:id', asyncHandler(c.getById));
// Ghi danh muc thuoc: TAM THOI chi admin (ADMIN_API_KEY). Khi co Auth thi chi cho vai tro quan tri.
router.post('/', requireAdmin, asyncHandler(c.create));
router.put('/:id', requireAdmin, asyncHandler(c.update));
router.delete('/:id', requireAdmin, asyncHandler(c.remove));

module.exports = router;
