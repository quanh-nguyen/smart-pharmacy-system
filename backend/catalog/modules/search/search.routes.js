const router = require('express').Router();
const c = require('./search.controller');
const { asyncHandler } = require('../../utils/helpers');

router.get('/', asyncHandler(c.quick));
router.get('/medicines', asyncHandler(c.suggest));
router.post('/pharmacies', asyncHandler(c.pharmacies));

module.exports = router;
