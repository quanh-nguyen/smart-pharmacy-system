// Nạp tất cả model + khai báo quan hệ. Mọi nơi khác chỉ require('../models').
const { sequelize } = require('../config/database');
const { User, Drug, Pharmacy, Inventory } = require('./shared');
const { Prescription, PrescriptionItem } = require('./Prescription');
const { Order, OrderItem, OrderStatusHistory } = require('./Order');
const { Notification } = require('./Notification');
const { SymptomQuestionnaire } = require('./SymptomQuestionnaire');

const restrict = { onDelete: 'RESTRICT', onUpdate: 'CASCADE' };
const cascade = { onDelete: 'CASCADE', onUpdate: 'CASCADE' };
const setNull = { onDelete: 'SET NULL', onUpdate: 'CASCADE' };

// ---- Shared catalog and read-only user projection ----
Pharmacy.belongsTo(User, { as: 'owner', foreignKey: 'ownerId', ...restrict, constraints: false });
Inventory.belongsTo(Pharmacy, { as: 'pharmacy', foreignKey: 'pharmacyId', ...cascade });
Inventory.belongsTo(Drug, { as: 'drug', foreignKey: 'drugId', ...cascade });

// ---- Prescriptions ----
Prescription.belongsTo(User, { as: 'customer', foreignKey: 'customerId', ...restrict, constraints: false });
Prescription.hasMany(PrescriptionItem, { as: 'items', foreignKey: 'prescriptionId', ...cascade });
PrescriptionItem.belongsTo(Drug, { as: 'drug', foreignKey: 'drugId', ...setNull });

// ---- Orders ----
Order.belongsTo(User, { as: 'customer', foreignKey: 'customerId', ...restrict, constraints: false });
Order.belongsTo(Pharmacy, { as: 'pharmacy', foreignKey: 'pharmacyId', ...restrict });
Order.belongsTo(Prescription, { as: 'prescription', foreignKey: 'prescriptionId', ...restrict });
Order.hasMany(OrderItem, { as: 'items', foreignKey: 'orderId', ...cascade });
OrderItem.belongsTo(Drug, { as: 'drug', foreignKey: 'drugId', ...restrict });
Order.hasMany(OrderStatusHistory, { as: 'statusHistory', foreignKey: 'orderId', ...cascade });
OrderStatusHistory.belongsTo(User, { as: 'changedByUser', foreignKey: 'changedBy', ...setNull, constraints: false });

// ---- Notifications ----
Notification.belongsTo(User, { as: 'user', foreignKey: 'userId', ...cascade, constraints: false });

// ---- Symptoms ----
SymptomQuestionnaire.belongsTo(User, { as: 'creator', foreignKey: 'createdBy', ...setNull, constraints: false });
SymptomQuestionnaire.belongsTo(User, { as: 'approver', foreignKey: 'approvedBy', ...setNull, constraints: false });

module.exports = {
  sequelize,
  User, Drug, Pharmacy, Inventory,
  Prescription, PrescriptionItem,
  Order, OrderItem, OrderStatusHistory,
  Notification,
  SymptomQuestionnaire,
};
