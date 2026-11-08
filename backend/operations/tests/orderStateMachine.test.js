const test = require('node:test');
const assert = require('node:assert/strict');
const sm = require('../src/modules/orders/orderStateMachine');

test('luồng chuẩn: pending -> confirmed -> preparing -> delivering -> completed', () => {
  assert.ok(sm.canTransition('pending', 'confirmed', 'pharmacy'));
  assert.ok(sm.canTransition('confirmed', 'preparing', 'pharmacy'));
  assert.ok(sm.canTransition('preparing', 'delivering', 'pharmacy'));
  assert.ok(sm.canTransition('delivering', 'completed', 'customer'));
});

test('không được nhảy cóc hoặc quay lui', () => {
  assert.equal(sm.canTransition('pending', 'completed', 'pharmacy'), false);
  assert.equal(sm.canTransition('delivering', 'pending', 'admin'), false);
  assert.throws(() => sm.assertTransition('pending', 'delivering', 'pharmacy'), { status: 409 });
});

test('khách chỉ được hủy khi đơn còn pending', () => {
  assert.ok(sm.canTransition('pending', 'cancelled', 'customer'));
  assert.equal(sm.canTransition('confirmed', 'cancelled', 'customer'), false);
});

test('khách không được tự xác nhận đơn -> 403', () => {
  assert.throws(() => sm.assertTransition('pending', 'confirmed', 'customer'), { status: 403 });
});

test('trạng thái cuối không có bước tiếp theo', () => {
  for (const s of ['completed', 'rejected', 'cancelled']) {
    assert.ok(sm.FINAL_STATUSES.includes(s));
    assert.deepEqual(sm.nextStatuses(s, 'admin'), []);
  }
});

test('trạng thái lạ / key prototype không làm hỏng máy trạng thái', () => {
  assert.equal(sm.canTransition('pending', 'constructor', 'admin'), false);
  assert.equal(sm.canTransition('unknown', 'confirmed', 'admin'), false);
});

test('nextStatuses theo vai trò', () => {
  assert.deepEqual(sm.nextStatuses('pending', 'pharmacy').sort(), ['confirmed', 'rejected']);
  assert.deepEqual(sm.nextStatuses('pending', 'customer'), ['cancelled']);
});
