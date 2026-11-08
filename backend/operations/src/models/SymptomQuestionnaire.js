const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { pk, userFk, fk, jsonColumn } = require('./helpers');

const QUESTION_TYPES = ['boolean', 'single', 'multi', 'number'];
const Q_STATUSES = ['draft', 'approved', 'archived'];
const DEFAULT_DISCLAIMER =
  'Thông tin chỉ mang tính tham khảo, không thay thế chẩn đoán của bác sĩ. ' +
  'Hãy hỏi ý kiến dược sĩ trước khi dùng thuốc và đi khám nếu triệu chứng không cải thiện.';

// questions: [{ id, text, type, options?: [{value,label}], required? }]
// rules:     [{ id, description?, priority?, redFlag?, conditions, suggestions?: [{drug, note}], advice? }]
// Lưu dạng JSON vì chuyên gia/admin soạn và duyệt cả bộ như một khối có phiên bản.
const SymptomQuestionnaire = sequelize.define(
  'SymptomQuestionnaire',
  {
    id: pk(),
    code: { type: DataTypes.STRING(50), allowNull: false }, // các phiên bản cùng code là cùng một bộ
    version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: DataTypes.TEXT,
    status: { type: DataTypes.ENUM(...Q_STATUSES), allowNull: false, defaultValue: 'draft' },
    questions: jsonColumn('questions'),
    rules: jsonColumn('rules'),
    disclaimer: DataTypes.TEXT, // TEXT không có DEFAULT trong MySQL -> gán ở hook
    createdBy: userFk(true),
    approvedBy: userFk(true),
    approvedAt: DataTypes.DATE,
  },
  {
    tableName: 'symptom_questionnaires',
    indexes: [{ unique: true, fields: ['code', 'version'] }, { fields: ['status'] }],
    hooks: {
      beforeValidate(q) {
        if (!q.disclaimer) q.disclaimer = DEFAULT_DISCLAIMER;
        if (!q.rules) q.rules = [];
      },
    },
  },
);

module.exports = { SymptomQuestionnaire, QUESTION_TYPES, Q_STATUSES };
