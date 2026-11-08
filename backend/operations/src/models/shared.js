// These models project the shared catalog. Never call sequelize.sync() on them.
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pk, fk, userFk } = require('./helpers');

const User = sequelize.define('User', {
  id: { ...userFk(), primaryKey: true },
  name: DataTypes.STRING(100), email: DataTypes.STRING(254), role: DataTypes.STRING(20),
}, { tableName: 'business_user_profiles', timestamps: false });

const Drug = sequelize.define('Drug', {
  id: pk(), name: DataTypes.STRING(200), activeIngredient: DataTypes.STRING(200),
  strength: DataTypes.STRING(50), dosageForm: DataTypes.STRING(50),
  isPrescription: DataTypes.BOOLEAN, isActive: DataTypes.BOOLEAN,
}, { tableName: 'medicines', timestamps: false, defaultScope: { where: { isActive: true } } });

const Pharmacy = sequelize.define('Pharmacy', {
  id: pk(), name: DataTypes.STRING(150), ownerId: userFk(true),
  address: DataTypes.STRING(255), phone: DataTypes.STRING(20),
  verificationStatus: DataTypes.STRING(20), isActive: DataTypes.BOOLEAN,
  verified: { type: DataTypes.VIRTUAL, get() {
    return this.verificationStatus === 'approved' && this.isActive === true;
  } },
}, { tableName: 'pharmacies', timestamps: false });

const Inventory = sequelize.define('Inventory', {
  pharmacyId: { ...fk(), primaryKey: true },
  drugId: { ...fk(), field: 'medicine_id', primaryKey: true },
  quantity: DataTypes.INTEGER,
  price: { type: DataTypes.DECIMAL(12, 0), get() { return Number(this.getDataValue('price')); } },
  updatedAt: DataTypes.DATE,
}, { tableName: 'inventory', timestamps: false });

module.exports = { User, Drug, Pharmacy, Inventory };
