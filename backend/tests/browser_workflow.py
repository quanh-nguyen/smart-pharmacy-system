"""Real Chromium + real MySQL smoke test. Start npm start first; uses a local test DB only."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import struct
import subprocess
import time
import unittest
import uuid
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = os.environ.get('BACKEND_TEST_ORIGIN', 'http://127.0.0.1:3000')

class BackendBrowserWorkflow(unittest.TestCase):
    def test_owner_admin_customer_order_and_persistent_session(self):
        # Generate a new test-only admin; capture secrets in memory, never in output or a committed fixture.
        seed = r"""
require('./src/bootstrap');
const crypto = require('node:crypto');
const db = require('./auth/src/db/mysql');
const User = require('./auth/src/models/User');
const totp = require('./auth/src/utils/totp');
const { hashPassword } = require('./auth/src/utils/password');
(async () => {
  const password = crypto.randomBytes(18).toString('hex'), secret = totp.newSecret();
  const email = 'browser-admin-' + crypto.randomBytes(6).toString('hex') + '@example.org';
  await User.create({ email, password: await hashPassword(password), role: 'ADMIN', mfaEnabled: true,
    mfaSecretEncrypted: totp.encrypt(secret) });
  process.stdout.write(JSON.stringify({email, password, secret}));
})().catch(() => { process.exitCode = 1; }).finally(() => db.disconnect());
"""
        fixture = json.loads(subprocess.check_output(['node', '-e', seed], cwd=ROOT, env={**os.environ, 'LOG_LEVEL': 'silent'}))
        suffix = uuid.uuid4().hex[:10]
        store_name = f'Browser Pharmacy {suffix}'
        medicine_name = f'Browser Medicine {suffix}'
        errors = []
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else p.chromium.executable_path)
            browser = p.chromium.launch(executable_path=executable, args=['--no-sandbox'])
            owner = browser.new_page(viewport={'width': 1280, 'height': 900})
            owner.on('pageerror', lambda error: errors.append(str(error)))
            owner.goto(f'{ORIGIN}/pharmacy/')
            form = owner.locator('#ownerAuthForm')
            form.locator('[name=name]').fill('Browser Owner')
            form.locator('[name=email]').fill(f'owner-{suffix}@example.org')
            form.locator('[name=password]').fill(fixture['password'])
            form.locator('[name=mode]').select_option('register')
            form.locator('button').click()
            expect(owner.locator('#workspace')).to_be_visible()
            profile = owner.locator('#profileForm')
            for name, value in {'name': store_name, 'address': '12 Browser Test Street', 'lat': '21.028', 'lng': '105.834'}.items():
                profile.locator(f'[name={name}]').fill(value)
            profile.locator('[type=submit]').click()
            expect(owner.locator('#verification')).to_have_text('Đang chờ duyệt')

            admin = browser.new_page()
            admin.on('pageerror', lambda error: errors.append(str(error)))
            admin.goto(f'{ORIGIN}/admin/')
            form = admin.locator('#loginForm')
            form.locator('[name=email]').fill(fixture['email'])
            form.locator('[name=password]').fill(fixture['password'])
            counter = struct.pack('>Q', int(time.time() // 30))
            digest = hmac.new(bytes.fromhex(fixture['secret']), counter, hashlib.sha1).digest()
            offset = digest[-1] & 15
            code = str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
            form.locator('[name=totp]').fill(code)
            form.locator('button').click()
            expect(admin.locator('#workspace')).to_be_visible()
            store = admin.locator('#stores article').filter(has_text=store_name)
            expect(store).to_be_visible()
            store.locator('[data-verification=approved]').click()
            expect(admin.locator('#status')).to_have_text('Đã cập nhật hồ sơ và quyền tài khoản chủ nhà thuốc.')
            form = admin.locator('#medicineForm')
            form.locator('[name=name]').fill(medicine_name)
            form.locator('[name=unit]').fill('Hộp')
            form.locator('[type=submit]').click()
            expect(admin.locator('#status')).to_have_text('Đã lưu danh mục thuốc.')

            owner.locator('#reload').click()
            expect(owner.locator('#verification')).to_have_text('Đã được duyệt')
            form = owner.locator('#inventoryForm')
            expect(form.locator('option').filter(has_text=medicine_name)).to_have_count(1)
            form.locator('select').select_option(label=medicine_name + ' ')
            form.locator('[name=price]').fill('15000')
            form.locator('[name=quantity]').fill('10')
            form.locator('button').click()
            expect(owner.locator('#inventory')).to_contain_text(medicine_name)

            customer = browser.new_page(viewport={'width': 1360, 'height': 900})
            customer.on('pageerror', lambda error: errors.append(str(error)))
            customer.goto(ORIGIN)
            customer.locator('#customerRegisterButton').click()
            customer.locator('#authCustomerName').fill('Browser Customer')
            customer.locator('#authEmail').fill(f'customer-{suffix}@example.org')
            customer.locator('#authPassword').fill(fixture['password'])
            customer.locator('#authSubmit').click()
            expect(customer.locator('#customerDashboard')).to_be_visible()
            customer.locator('#apiStoreSearch input').fill(store_name)
            customer.locator('#apiStoreSearch button').click()
            customer.locator('#apiStoreResults button').filter(has_text=store_name).click()
            form = customer.locator('#apiOrderForm')
            expect(form).to_be_visible()
            form.locator('[name=quantity]').fill('2')
            form.locator('[name=shippingAddress]').fill('20 Customer Test Street')
            form.locator('[name=phone]').fill('0901234567')
            form.locator('button').click()
            expect(customer.locator('#customerHistoryCount')).to_have_text('1 đơn')
            expect(customer.locator('#customerOrderHistory')).to_contain_text('30.000')
            customer.locator('#backToSearchButton').click()
            expect(customer.locator('#customerNavGreeting')).to_have_text('Xin chào, Browser Customer')
            customer.reload()
            expect(customer.locator('#customerHistoryButton')).to_be_visible()
            customer.locator('#customerHistoryButton').click()
            expect(customer.locator('#customerHistoryCount')).to_have_text('1 đơn')
            # API mode must never save passwords in the demo account store.
            self.assertIsNone(customer.evaluate('localStorage.getItem("smartPharmacyAccounts")'))
            owner.locator('#reload').click()
            order = owner.locator('#orders article').filter(has_text='Browser Customer')
            expect(order).to_have_count(1)
            order.locator('[data-detail]').click()
            expect(order).to_contain_text(medicine_name)
            order.locator('[data-status=confirmed]').click()
            expect(owner.locator('#orders')).to_contain_text('Xác nhận')
            self.assertEqual(errors, [])
            browser.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
