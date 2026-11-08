const { Sequelize } = require('sequelize');
const { db } = require('./env');

const sequelize = new Sequelize(db.name, db.user, db.password, {
  host: db.host,
  port: db.port,
  dialect: 'mysql',
  logging: db.logging ? console.log : false,
  timezone: '+07:00', // lưu DATETIME theo giờ Việt Nam
  pool: { max: 10, min: 0, idle: 10000 },
  define: {
    underscored: true, // customerId -> cột customer_id, createdAt -> created_at
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
});

// Tạo database nếu chưa có (dùng cho db:sync và seed)
async function ensureDatabase() {
  if (!/^[A-Za-z0-9_]+$/.test(db.name)) throw new Error('DB_NAME chỉ gồm chữ, số, dấu _');
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: db.host, port: db.port, user: db.user, password: db.password,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();
}

module.exports = { sequelize, ensureDatabase };
