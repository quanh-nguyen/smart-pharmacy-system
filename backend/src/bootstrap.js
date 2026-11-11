const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// One database contract for all three imported modules. Existing explicit values win.
for (const [business, auth] of Object.entries({
  DB_HOST: 'MYSQL_HOST', DB_PORT: 'MYSQL_PORT', DB_NAME: 'MYSQL_DATABASE',
  DB_USER: 'MYSQL_USER', DB_PASSWORD: 'MYSQL_PASSWORD'
})) {
  if (process.env[auth] !== undefined) process.env[business] = process.env[auth];
  else if (process.env[business] !== undefined) process.env[auth] = process.env[business];
}
process.env.CLIENT_ORIGIN = process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3000';
