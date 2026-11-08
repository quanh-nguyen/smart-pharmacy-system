const Roles = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  PHARMACY: 'PHARMACY',
  ADMIN: 'ADMIN'
});

const SELF_REGISTERABLE_ROLES = Object.freeze([
  Roles.CUSTOMER,
  Roles.PHARMACY
]);

module.exports = { Roles, SELF_REGISTERABLE_ROLES };
