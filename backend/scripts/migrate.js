require('../src/bootstrap');
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../auth/src/db/mysql');

async function migrate() {
  // Refuse pre-existing stub tables instead of silently accepting incompatible IDs.
  const [tables] = await db.execute(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`);
  if (tables.length && !tables.some(c => c.COLUMN_NAME === 'payload' && c.DATA_TYPE === 'json')) {
    throw new Error('Existing users table is incompatible. Use a new database; do not overwrite existing application data.');
  }
  for (const [table, field] of [['users', 'id'], ['pharmacies', 'owner_id'], ['orders', 'customer_id'],
    ['prescriptions', 'customer_id'], ['notifications', 'user_id']]) {
    const [columns] = await db.execute(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
    if (columns.length && !columns.some(c => c.COLUMN_NAME === field && c.DATA_TYPE === 'char' && c.CHARACTER_MAXIMUM_LENGTH === 24)) {
      throw new Error(`Existing ${table}.${field} is incompatible with Auth IDs. Use a new database and migrate existing data separately.`);
    }
  }
  await require('../auth/src/scripts/migrate').migrate();
  for (const file of ['002_catalog.sql', '003_operations.sql', '004_business_users_view.sql']) {
    const ddl = await fs.readFile(path.join(__dirname, '../sql', file), 'utf8');
    const statements = ddl.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of statements) await db.queryRaw(sql);
    const name = file.replace('.sql', '');
    await db.execute('INSERT INTO schema_migrations (id, payload) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE id=id',
      [name, JSON.stringify({ name, appliedAt: new Date().toISOString() })]);
    console.log(`Applied ${name}`);
  }
}
if (require.main === module) migrate().catch(error => {
  console.error(`Migration failed: ${error.message}`); process.exitCode = 1;
}).finally(() => db.disconnect());
module.exports = { migrate };
