const router = require('express').Router();
const c = require('./pharmacies.controller');
const { asyncHandler } = require('../../utils/helpers');
const { requireAdmin } = require('../../middlewares/auth');

// Mount tai /api/admin/pharmacies. Moi route o day deu phai qua requireAdmin.
router.use(requireAdmin);

router.get('/', asyncHandler(c.adminList)); // ?status=pending|approved|rejected|all (mac dinh pending)
router.get('/:id', asyncHandler(c.adminGetById));
router.patch('/:id/verification', asyncHandler(c.setVerification));

module.exports = router;
