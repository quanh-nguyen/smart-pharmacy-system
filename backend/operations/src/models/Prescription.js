const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pk, userFk, fk } = require('./helpers');

const STATUSES = ['uploaded', 'processing', 'ocr_done', 'confirmed', 'failed'];

const Prescription = sequelize.define(
  'Prescription',
  {
    id: pk(),
    customerId: userFk(),
    filePath: { type: DataTypes.STRING(500), allowNull: false },
    fileOriginalName: DataTypes.STRING(255),
    fileMimeType: DataTypes.STRING(100),
    fileSize: DataTypes.INTEGER.UNSIGNED,
    status: { type: DataTypes.ENUM(...STATUSES), allowNull: false, defaultValue: 'uploaded' },
    ocrText: DataTypes.TEXT('medium'),
    doctorName: DataTypes.STRING(150),
    issuedAt: DataTypes.DATEONLY,
    errorMessage: DataTypes.STRING(500),
    confirmedAt: DataTypes.DATE,
  },
  {
    tableName: 'prescriptions',
    indexes: [{ fields: ['customer_id', 'created_at'] }, { fields: ['status'] }],
  },
);

// Không lộ đường dẫn file trên server ra API
Prescription.prototype.toJSON = function toJSON() {
  const values = this.get({ plain: true });
  delete values.filePath;
  return values;
};

const PrescriptionItem = sequelize.define(
  'PrescriptionItem',
  {
    id: pk(),
    prescriptionId: fk(),
    drugId: fk(true), // thuốc khớp trong danh mục, null = chưa khớp
    rawText: DataTypes.STRING(500), // dòng gốc OCR đọc được
    drugName: { type: DataTypes.STRING(200), allowNull: false },
    strength: DataTypes.STRING(50),
    matchScore: DataTypes.FLOAT, // 0..1
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    instructions: DataTypes.STRING(500),
  },
  { tableName: 'prescription_items', timestamps: false },
);

module.exports = { Prescription, PrescriptionItem, STATUSES };
