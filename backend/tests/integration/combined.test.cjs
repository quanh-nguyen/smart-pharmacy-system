process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_SALT_ROUNDS = '10';
process.env.AUTH_RATE_LIMIT_IP_MAX = '200';
process.env.AUTH_RATE_LIMIT_IDENTITY_MAX = '100';
require('../../src/bootstrap');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../../src/app');
const db = require('../../auth/src/db/mysql');
const { pool } = require('../../catalog/src/config/db');
const { sequelize } = require('../../operations/src/models');
const User = require('../../auth/src/models/User');
const { hashPassword } = require('../../auth/src/utils/password');
const app = createApp();
const suffix = crypto.randomBytes(6).toString('hex'), password = crypto.randomBytes(18).toString('hex');
const auth = (method, path, token, body) => {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};
function code(secret, step) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', Buffer.from(secret, 'hex')).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

test('shared MySQL workflow and permissions across all three backend packages', async t => {
  let customer, otherCustomer, owner, adminToken, storeId, medicineId, orderId;
  try {
    await t.test('additive migrations can run twice', async () => {
      await require('../../scripts/migrate').migrate();
      await require('../../scripts/migrate').migrate();
    });
    await t.test('customer and pharmacy registration use the same 24-character identity', async () => {
      for (const role of ['CUSTOMER', 'PHARMACY']) {
        const response = await request(app).post('/api/v1/auth/register').send({ email: `${role}-${suffix}@example.org`, password, role, name: `Test ${role}` }).expect(201);
        const data = response.body.data; assert.match(data.user.id, /^[0-9a-f]{24}$/); assert.equal(data.user.name, `Test ${role}`);
        assert.ok(data.accessToken); assert.ok(data.refreshToken);
        if (role === 'CUSTOMER') customer = data; else owner = data;
      }
      otherCustomer = (await request(app).post('/api/v1/auth/register').send({ email: `other-${suffix}@example.org`, password }).expect(201)).body.data;
    });
    await t.test('public registration cannot create ADMIN', async () => {
      await request(app).post('/api/v1/auth/register').send({ email: `attack-${suffix}@example.org`, password, role: 'ADMIN' }).expect(400);
    });
    await t.test('admin must enroll MFA before privileged API access', async () => {
      const email = `admin-${suffix}@example.org`;
      await User.create({ email, password: await hashPassword(password), role: 'ADMIN' });
      const login = (await request(app).post('/api/v1/auth/login').send({ email, password }).expect(200)).body.data;
      assert.equal(login.mfaEnrollmentRequired, true); assert.equal(login.accessToken, undefined);
      await auth('get', '/api/admin/accounts', login.enrollmentToken).expect(401);
      const setup = (await auth('post', '/api/v1/admin/mfa/setup', login.enrollmentToken, { currentPassword: password }).expect(200)).body.data;
      const current = Math.floor(Date.now() / 30000);
      await auth('post', '/api/v1/admin/mfa/confirm', login.enrollmentToken, { code: code(setup.secretHex, current - 1) }).expect(200);
      adminToken = (await request(app).post('/api/v1/auth/login').send({ email, password, totp: code(setup.secretHex, current) }).expect(200)).body.data.accessToken;
      await auth('get', '/api/admin/accounts', adminToken).expect(200);
    });
    await t.test('only the pharmacy account can create its own pending profile', async () => {
      const body = { name: `Integration Pharmacy ${suffix}`, address: '12 Test Street, Hanoi', lat: 21.028, lng: 105.834, owner_id: customer.user.id, verification_status: 'approved' };
      await request(app).post('/api/pharmacies').send(body).expect(401);
      await auth('post', '/api/pharmacies', customer.accessToken, body).expect(403);
      const store = (await auth('post', '/api/pharmacies', owner.accessToken, body).expect(201)).body.data;
      storeId = store.id; assert.equal(store.verification_status, 'pending');
      const [[row]] = await pool.query('SELECT owner_id FROM pharmacies WHERE id = ?', [storeId]); assert.equal(row.owner_id, owner.user.id);
      await request(app).get(`/api/pharmacies/${storeId}`).expect(404);
      await auth('get', '/api/owner/workspace', owner.accessToken).expect(200);
    });
    await t.test('admin catalog authorization and approval synchronize the Auth account', async () => {
      const body = { name: `Medicine ${suffix}`, active_ingredient: 'Test compound', unit: 'Hộp' };
      await auth('post', '/api/medicines', owner.accessToken, body).expect(403);
      medicineId = (await auth('post', '/api/medicines', adminToken, body).expect(201)).body.data.id;
      await auth('put', `/api/pharmacies/${storeId}/inventory/${medicineId}`, owner.accessToken, { price: 15000, quantity: 10 }).expect(403);
      await auth('patch', `/api/admin/pharmacies/${storeId}/verification`, adminToken, { status: 'approved' }).expect(200);
      const user = await User.findById(owner.user.id).lean(); assert.equal(user.isVerified, true);
      const [audit] = await db.execute('SELECT id FROM pharmacyverificationevents WHERE pharmacy_id = ?', [owner.user.id]); assert.equal(audit.length, 1);
      await request(app).get(`/api/pharmacies/${storeId}`).expect(200);
    });
    await t.test('approved owner can set inventory but customers cannot', async () => {
      const path = `/api/pharmacies/${storeId}/inventory/${medicineId}`;
      await auth('put', path, customer.accessToken, { price: 1, quantity: 999 }).expect(403);
      await auth('put', path, owner.accessToken, { price: 15000, quantity: 10 }).expect(200);
      const result = await request(app).get(`/api/pharmacies/${storeId}/inventory`).expect(200); assert.equal(result.body.data[0].quantity, 10);
      const nearby = await request(app).get('/api/pharmacies/nearby?lat=21.028&lng=105.834&radius_km=3&limit=50').expect(200);
      assert.ok(nearby.body.data.some(row => row.id === storeId));
    });
    await t.test('a real customer order decrements the shared catalog inventory', async () => {
      const order = await auth('post', '/api/orders', customer.accessToken, { pharmacyId: storeId, items: [{ drugId: medicineId, quantity: 2 }], shippingAddress: '10 Customer Street', phone: '0901234567' }).expect(201);
      orderId = order.body.id; assert.equal(order.body.customerId, customer.user.id); assert.equal(Number(order.body.totalAmount), 30000);
      assert.equal(order.body.customer.name, 'Test CUSTOMER');
      const [[row]] = await pool.query('SELECT quantity FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?', [storeId, medicineId]); assert.equal(row.quantity, 8);
    });
    await t.test('customer history is private; owner sees only its pharmacy orders', async () => {
      const mine = await auth('get', '/api/orders', customer.accessToken).expect(200); assert.ok(mine.body.items.some(order => order.id === orderId));
      await auth('get', `/api/orders/${orderId}`, otherCustomer.accessToken).expect(404);
      const orders = await auth('get', '/api/orders', owner.accessToken).expect(200); assert.ok(orders.body.items.some(order => order.id === orderId));
    });
    await t.test('insufficient stock rolls back without creating another order', async () => {
      await auth('post', '/api/orders', customer.accessToken, { pharmacyId: storeId, items: [{ drugId: medicineId, quantity: 100 }], shippingAddress: '10 Customer Street', phone: '0901234567' }).expect(409);
      const mine = await auth('get', '/api/orders', customer.accessToken).expect(200); assert.equal(mine.body.total, 1);
    });
    await t.test('cancelling an order restores the same shared inventory exactly once', async () => {
      await auth('post', `/api/orders/${orderId}/cancel`, customer.accessToken, {}).expect(200);
      await auth('post', `/api/orders/${orderId}/cancel`, customer.accessToken, {}).expect(409);
      const [[row]] = await pool.query('SELECT quantity FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?', [storeId, medicineId]); assert.equal(row.quantity, 10);
    });
    await t.test('logout revokes JWT access to orders as well as Auth', async () => {
      await auth('post', '/api/v1/auth/logout', customer.accessToken, {}).set('Idempotency-Key', crypto.randomUUID()).expect(200);
      await auth('get', '/api/orders', customer.accessToken).expect(401);
    });
    await t.test('web config is same-origin and all workspace scripts are served', async () => {
      const config = await request(app).get('/runtime-config.js').expect(200); assert.match(config.text, /apiBaseUrl: ""/);
      for (const file of ['/', '/pharmacy/', '/admin/', '/api-client.js', '/pharmacy/backend-app.js', '/admin/backend-app.js']) await request(app).get(file).expect(200);
      await request(app).get('/api/health').expect(200);
      await request(app).get('/api/medicines').set('Origin', 'https://untrusted.example').expect(403);
    });
  } finally { await Promise.allSettled([db.disconnect(), pool.end(), sequelize.close()]); }
});
