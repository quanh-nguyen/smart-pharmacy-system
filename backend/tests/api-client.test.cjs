const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('parallel 401 responses rotate a refresh token once and retry with the new access token', async () => {
  const originalFetch = global.fetch;
  global.window = { SMART_PHARMACY_CONFIG: { apiBaseUrl: '' } };
  const storage = new Map();
  global.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const source = fs.readFileSync(require.resolve('../../docs/api-client.js'), 'utf8');
  const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  client.saveSession({ user: { role: 'CUSTOMER' }, accessToken: 'old', refreshToken: 'refresh-old' });
  let rotations = 0, retries = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith('/refresh')) {
      rotations++;
      await new Promise(resolve => setImmediate(resolve));
      return Response.json({ data: { accessToken: 'new', refreshToken: 'refresh-new' } });
    }
    if (options.headers.Authorization === 'Bearer old') return Response.json({ message: 'expired' }, { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer new'); retries++;
    return Response.json({ ok: true });
  };
  try {
    await Promise.all([client.apiRequest('/api/orders'), client.apiRequest('/api/notifications')]);
    assert.equal(rotations, 1); assert.equal(retries, 2);
    assert.equal(client.getSession().refreshToken, 'refresh-new');
    assert.equal(client.getSession().user.role, 'CUSTOMER');
  } finally { global.fetch = originalFetch; delete global.window; delete global.sessionStorage; }
});
