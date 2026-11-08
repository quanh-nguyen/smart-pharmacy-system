const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pk, userFk, fk, jsonColumn } = require('./helpers');

const Notification = sequelize.define(
  'Notification',
  {
    id: pk(),
    userId: userFk(),
    type: { type: DataTypes.STRING(50), allowNull: false }, // vd: order.created, order.confirmed
    title: { type: DataTypes.STRING(200), allowNull: false },
    message: { type: DataTypes.STRING(1000), allowNull: false },
    data: jsonColumn('data', { allowNull: true }), // vd: { orderId }
    readAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: 'notifications',
    indexes: [{ fields: ['user_id', 'read_at', 'created_at'] }],
  },
);

module.exports = { Notification };
