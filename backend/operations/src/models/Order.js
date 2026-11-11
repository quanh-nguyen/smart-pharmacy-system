const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pk, userFk, fk } = require('./helpers');
const { STATUSES } = require('../modules/orders/orderStateMachine');

const formatOrderCode = (id) => `DH${String(id).padStart(6, '0')}`;

const Order = sequelize.define(
  'Order',
  {
    id: pk(),
    code: {
      type: DataTypes.VIRTUAL,
      get() {
        return this.getDataValue('id') ? formatOrderCode(this.getDataValue('id')) : undefined;
      },
    },
    customerId: userFk(),
    pharmacyId: fk(),
    prescriptionId: fk(true),
    totalAmount: { type: DataTypes.DECIMAL(14, 0), allowNull: false }, // VND
    status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'pending' },
    shippingAddress: { type: DataTypes.STRING(300), allowNull: false },
    phone: { type: DataTypes.STRING(15), allowNull: false },
    note: DataTypes.STRING(500),
  },
  {
    tableName: 'orders',
    indexes: [
      { fields: ['customer_id', 'created_at'] },
      { fields: ['pharmacy_id', 'status', 'created_at'] },
    ],
  },
);

const OrderItem = sequelize.define(
  'OrderItem',
  {
    id: pk(),
    orderId: fk(),
    drugId: fk(),
    name: { type: DataTypes.STRING(255), allowNull: false }, // chụp lại tên/giá lúc đặt
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    unitPrice: { type: DataTypes.DECIMAL(12, 0), allowNull: false },
    isPrescription: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  { tableName: 'order_items', timestamps: false },
);

const OrderStatusHistory = sequelize.define(
  'OrderStatusHistory',
  {
    id: pk(),
    orderId: fk(),
    fromStatus: { type: DataTypes.ENUM(...STATUSES), allowNull: true },
    toStatus: { type: DataTypes.ENUM(...STATUSES), allowNull: false },
    changedBy: userFk(true),
    role: DataTypes.STRING(20),
    note: DataTypes.STRING(500),
  },
  { tableName: 'order_status_history', updatedAt: false },
);

module.exports = { Order, OrderItem, OrderStatusHistory, formatOrderCode };
