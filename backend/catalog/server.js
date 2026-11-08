require('dotenv').config();
const app = require('./app');
const { pool } = require('./config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('Da ket noi MySQL');
  } catch (err) {
    console.error('Khong ket noi duoc MySQL:', err.message);
    process.exit(1);
  }
  app.listen(PORT, () => console.log(`API chay tai http://localhost:${PORT}`));
}

start();
