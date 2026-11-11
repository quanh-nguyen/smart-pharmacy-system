const verifyToken = require('./verifyToken');
const checkRole = require('./checkRole');
const requireVerifiedPharmacy = require('./requireVerifiedPharmacy');
const { Roles } = require('../constants/roles');
module.exports = [verifyToken, checkRole([Roles.PHARMACY]), requireVerifiedPharmacy];
