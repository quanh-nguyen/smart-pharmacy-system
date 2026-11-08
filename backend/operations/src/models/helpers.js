const { DataTypes } = require('sequelize');

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = (allowNull = false) => ({ type: DataTypes.INTEGER, allowNull });

const userFk = (allowNull = false) => ({ type: DataTypes.CHAR(24), allowNull });

// Cột JSON chạy được cả MySQL 8 (trả object) lẫn MariaDB/XAMPP (trả chuỗi)
function jsonColumn(name, { allowNull = false } = {}) {
  return {
    type: DataTypes.JSON,
    allowNull,
    get() {
      const v = this.getDataValue(name);
      if (typeof v !== 'string') return v;
      try {
        return JSON.parse(v);
      } catch {
        return v;
      }
    },
  };
}

module.exports = { pk, fk, userFk, jsonColumn };
