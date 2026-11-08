const express = require('express');
const pharmacyController = require('../controllers/pharmacyController');
const pharmacyGuard = require('../middlewares/pharmacyGuard');
const router = express.Router();
router.use(pharmacyGuard);
// Compatibility endpoint retained until clients migrate; new business routes inherit the guard.
router.get('/workspace', pharmacyController.getWorkspace);
module.exports = router;
