'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
if (process.env.RUN_MYSQL_INTEGRATION !== '1') {
  test('MySQL HTTP integration suite (set RUN_MYSQL_INTEGRATION=1 after migration)',{skip:true},()=>{});
} else {
  const request=require('supertest');
  const { createApp }=require('../src/app');
  const db=require('../src/db/mysql');
  const { getDummyHash }=require('../src/utils/password');
  test('registration/login/duplicate/authorization/logout against MySQL', async (t) => {
    await db.connect();
    await getDummyHash();
    const app=createApp();
    const email=`smoke${Date.now()}@example.org`;
    const password='DemoTestPassword2026!';
    try {
      const register=await request(app).post('/api/v1/auth/register')
        .send({ email, password, role:'CUSTOMER' });
      assert.equal(register.status,201,JSON.stringify(register.body));
      const user=await db.connection.collection('users').findOne({email});
      assert.equal(user.isVerified,true);
      if (process.env.REFRESH_TOKENS_ENABLED === 'true') {
        const firstRefresh=register.body.data?.refreshToken;
        assert.ok(firstRefresh, 'Registration should return a refresh token');
        const rotation=await request(app).post('/api/v1/auth/refresh').send({refreshToken:firstRefresh});
        assert.equal(rotation.status,200,JSON.stringify(rotation.body));
        assert.ok(rotation.body.data?.refreshToken);
        const replay=await request(app).post('/api/v1/auth/refresh').send({refreshToken:firstRefresh});
        assert.equal(replay.status,401,'Consumed refresh token must be rejected');
        const revokedFamily=await request(app).post('/api/v1/auth/refresh')
          .send({refreshToken:rotation.body.data.refreshToken});
        assert.equal(revokedFamily.status,401,'Refresh token replay must revoke its family');
      }
      const duplicate=await request(app).post('/api/v1/auth/register')
        .send({email,password,role:'CUSTOMER'});
      assert.equal(duplicate.status,409);
      const login=await request(app).post('/api/v1/auth/login').send({email,password});
      assert.equal(login.status,200,JSON.stringify(login.body));
      const bearer=login.body.data?.accessToken || login.body.accessToken;
      assert.ok(bearer);
      const ready=await request(app).get('/health/ready');
      assert.equal(ready.status,200);
      assert.equal(ready.body.dependencies.mysql,'connected');
      const logout=await request(app).post('/api/v1/auth/logout')
        .set('Authorization',`Bearer ${bearer}`);
      assert.equal(logout.status,200,JSON.stringify(logout.body));
      const revoked=await request(app).post('/api/v1/auth/logout')
        .set('Authorization',`Bearer ${bearer}`);
      assert.equal(revoked.status,401);
      const roleResult=await db.connection.collection('users').updateOne({email},
        {$set:{role:'ADMIN'}}).then(()=>null,(err)=>err);
      assert.ok(roleResult, 'Role mutation must be rejected by SQL trigger');
    } finally {
      await db.connection.collection('users').deleteOne({email});
      await db.disconnect();
    }
  });
}
