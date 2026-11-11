const http = require('http');
const env = require('./config/env');
const { sequelize } = require('./models');
const app = require('./app');
const { initSocket } = require('./modules/notifications/socket');
const { registerOrderListeners } = require('./modules/notifications/notification.listeners');
const { recoverStuckJobs } = require('./modules/prescriptions/prescription.service');

async function start() {
  await sequelize.authenticate();
  console.log(`MySQL connected: ${env.db.host}:${env.db.port}/${env.db.name}`);

  const server = http.createServer(app);
  initSocket(server);
  registerOrderListeners();
  await recoverStuckJobs();

  server.listen(env.port, () => console.log(`API listening on http://localhost:${env.port}`));
}

start().catch((err) => {
  console.error(err.original?.sqlMessage || err);
  console.error('Không khởi động được. Đã tạo bảng chưa? Chạy: npm run db:sync (hoặc npm run seed)');
  process.exit(1);
});
