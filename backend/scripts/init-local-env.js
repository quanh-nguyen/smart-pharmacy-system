const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const target = path.join(root, '.env');
const random = () => crypto.randomBytes(32).toString('hex');
let template = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
for (const name of ['MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'JWT_SECRET', 'MFA_ENCRYPTION_KEY']) {
  template = template.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${random()}`);
}
fs.writeFileSync(target, template, { flag: 'wx', mode: 0o600 });
console.log('Created backend/.env for a new local development database. No existing file was overwritten.');
