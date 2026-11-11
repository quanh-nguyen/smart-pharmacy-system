// Tạo database (nếu chưa có) và các bảng còn thiếu theo model. Không xóa dữ liệu.
// Chạy: npm run db:sync   (thay cho việc import database/schema.sql bằng tay)
const { ensureDatabase } = require('../src/config/database');

async function main() {
  await ensureDatabase();
  const { sequelize } = require('../src/models');
  await sequelize.sync();
  console.log('Đã tạo/kiểm tra xong các bảng.');
  await sequelize.close();
}

main().catch((err) => {
  console.error(err.original?.sqlMessage || err);
  process.exit(1);
});
