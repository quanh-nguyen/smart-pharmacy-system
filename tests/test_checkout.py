"""Browser checks: python3 -m unittest discover -s tests -v (Playwright + Chromium)."""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright, expect


STORAGE_KEY = "smartPharmacyCheckout_v1"
ROOT = Path(__file__).resolve().parents[1]
DELIVERY_QUERY = "1 Tràng Tiền, Hà Nội"
DELIVERY_ADDRESS = {
    "place_id": 1001, "osm_id": 1001, "osm_type": "way", "lat": "21.024", "lon": "105.857",
    "display_name": "1, Tràng Tiền, phường Tràng Tiền, Hà Nội, Việt Nam",
    "address": {"house_number": "1", "road": "Tràng Tiền", "city": "Hà Nội", "country_code": "vn"},
}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class CheckoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(QuietHandler, directory=str(ROOT / "docs"))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("chromium-browser")
        cls.browser = cls.playwright.chromium.launch(
            **({"executable_path": executable} if executable else {}),
            headless=True, args=["--no-sandbox"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 1360, "height": 950}, timezone_id="Asia/Bangkok",
            geolocation={"latitude": 21.0285, "longitude": 105.8542},
            permissions=["geolocation"],
        )
        # Tests must work without external APIs, fonts, tiles or CDN availability.
        def local_request(route):
            if route.request.url.startswith(self.base + "/data/pharmacies/index.json"):
                route.fulfill(json={"version": 1, "datasets": []})
            elif route.request.url.startswith(self.base + "/"):
                route.continue_()
            elif route.request.url.startswith("https://nominatim.openstreetmap.org/search"):
                query = parse_qs(urlsplit(route.request.url).query).get('q', [''])[0]
                route.fulfill(json=[DELIVERY_ADDRESS] if query in {DELIVERY_QUERY, DELIVERY_ADDRESS['display_name']} else [])
            else:
                route.abort()
        self.context.route("**/*", local_request)
        self.errors = []
        self.context.on("page", lambda page: page.on("pageerror", lambda error: self.errors.append(str(error))))
        self.page = self.context.new_page()
        self.page.goto(self.base)

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "Uncaught JavaScript errors")

    def demo_checkout(self, page=None):
        page = page or self.page
        page.locator("#loadOrderDemo").click()
        expect(page.locator("#pharmacyList .order-button")).to_have_count(3)
        page.locator("#pharmacyList .order-button").first.click()
        page.locator("#fillDemoOrder").click()

    def state(self):
        return self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", STORAGE_KEY)

    def verify_delivery_address(self, page=None):
        page = page or self.page
        page.locator('#verifyDeliveryAddress').click()
        page.locator('#checkoutAddressResults input').first.check()
        expect(page.locator('#checkoutAddressStatus')).to_contain_text('Đã chọn địa chỉ')

    def place_order(self, page=None):
        page = page or self.page
        page.locator('#confirmCheckout').click()
        expect(page.locator('#checkoutReviewDialog')).to_be_visible()
        page.locator('#placeReviewedOrder').click()
        expect(page.locator('#invoiceDialog')).to_be_visible()

    def test_review_can_return_to_add_medicine_without_creating_an_order(self):
        self.demo_checkout()
        self.page.locator('#checkoutNote').fill('Gọi trước khi giao')
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutReviewDialog')).to_be_visible()
        expect(self.page.locator('#checkoutReviewContent')).to_contain_text('59.000 ₫')
        expect(self.page.locator('#checkoutReviewContent')).to_contain_text('Gọi trước khi giao')
        self.assertIsNone(self.state())
        expect(self.page.locator('#invoiceDialog')).not_to_be_visible()
        self.page.locator('#backToCheckout').click()
        expect(self.page.locator('#checkoutDialog')).to_be_visible()
        expect(self.page.locator('#cartQuantity0')).to_have_value('2')
        expect(self.page.locator('#checkoutNote')).to_have_value('Gọi trước khi giao')
        self.page.locator('#checkoutMedicineSearch').fill('khẩu trang')
        self.page.locator('#cartQuantity2').fill('1')
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutReviewContent')).to_contain_text('104.000 ₫')
        expect(self.page.locator('#checkoutReviewContent')).to_contain_text('Khẩu trang y tế')
        self.assertIsNone(self.state())
        self.page.locator('#placeReviewedOrder').click()
        expect(self.page.locator('#invoiceDialog')).to_be_visible()
        order = self.state()['orders'][0]
        self.assertEqual(order['total'], 104000)
        self.assertEqual([item['quantity'] for item in order['items']], [2, 1, 1])
        self.assertEqual(order['status'], 'Đã xác nhận · Demo')
        self.assertEqual(order['paymentStatus'], 'Chưa thanh toán')

    def test_escaping_review_returns_to_cart_without_changing_stock(self):
        self.demo_checkout()
        for close in ['escape', 'button']:
            self.page.locator('#confirmCheckout').click()
            expect(self.page.locator('#checkoutReviewDialog')).to_be_visible()
            if close == 'escape': self.page.keyboard.press('Escape')
            else: self.page.locator('#checkoutReviewDialog [data-close-dialog]').click()
            expect(self.page.locator('#checkoutDialog')).to_be_visible()
            expect(self.page.locator('#cartQuantity1')).to_have_value('1')
            self.assertIsNone(self.state())

    def test_delivery_address_must_be_found_and_explicitly_selected(self):
        self.demo_checkout()
        self.page.locator('#checkoutFulfillment').select_option('delivery')
        self.page.locator('#checkoutAddress').fill('99999 Đường Không Có Thật, Hà Nội')
        self.page.locator('#verifyDeliveryAddress').click()
        expect(self.page.locator('#checkoutAddressError')).to_contain_text('Không tìm thấy')
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutReviewDialog')).not_to_be_visible()
        expect(self.page.locator('#invoiceDialog')).not_to_be_visible()
        self.assertIsNone(self.state())
        self.page.locator('#checkoutAddress').fill(DELIVERY_QUERY)
        self.page.locator('#verifyDeliveryAddress').click()
        expect(self.page.locator('#checkoutAddressResults input')).to_have_count(1)
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutAddressError')).to_contain_text('chọn địa chỉ')
        expect(self.page.locator('#checkoutReviewDialog')).not_to_be_visible()
        self.page.locator('#checkoutAddressResults input').check()
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutReviewDialog')).to_be_visible()
        expect(self.page.locator('#checkoutReviewContent')).to_contain_text(DELIVERY_ADDRESS['display_name'])
        expect(self.page.locator('.review-verified')).to_be_visible()
        self.assertIsNone(self.state())
        self.page.locator('#placeReviewedOrder').click()
        order = self.state()['orders'][0]
        self.assertEqual(order['address'], DELIVERY_ADDRESS['display_name'])
        self.assertEqual(order['deliveryLocation']['houseNumber'], '1')
        self.assertEqual(order['deliveryLocation']['latitude'], 21.024)
        self.assertEqual(order['shipping'], 15000)

    def test_geocoder_cannot_validate_a_city_street_or_different_house(self):
        self.demo_checkout()
        self.page.locator('#checkoutFulfillment').select_option('delivery')
        responses = [
            {**DELIVERY_ADDRESS, 'address': {'city': 'Hà Nội', 'country_code': 'vn'}},
            {**DELIVERY_ADDRESS, 'address': {'road': 'Tràng Tiền', 'city': 'Hà Nội', 'country_code': 'vn'}},
            {**DELIVERY_ADDRESS, 'display_name': '2, Tràng Tiền, Hà Nội, Việt Nam',
             'address': {**DELIVERY_ADDRESS['address'], 'house_number': '2'}},
            {**DELIVERY_ADDRESS, 'address': {**DELIVERY_ADDRESS['address'], 'country_code': 'us'}},
        ]
        pending_response = []
        self.page.route('https://nominatim.openstreetmap.org/search**', lambda route: route.fulfill(json=pending_response))
        for index, result in enumerate(responses):
            with self.subTest(index=index):
                # A unique extra locality avoids caching a previous negative lookup.
                query = f'1 Tràng Tiền, Hà Nội, khu {index}'
                pending_response[:] = [{**result, 'display_name': result['display_name'] + f', khu {index}'}]
                self.page.locator('#checkoutAddress').fill(query)
                self.page.locator('#verifyDeliveryAddress').click()
                expect(self.page.locator('#checkoutAddressError')).to_contain_text('Không tìm thấy')
                expect(self.page.locator('#checkoutAddressResults')).not_to_be_visible()
                self.assertIsNone(self.state())

    def test_editing_a_selected_delivery_address_requires_verification_again(self):
        self.demo_checkout()
        self.page.locator('#checkoutFulfillment').select_option('delivery')
        self.verify_delivery_address()
        self.page.locator('#confirmCheckout').click()
        self.page.locator('#backToCheckout').click()
        expect(self.page.locator('#checkoutAddressStatus')).to_contain_text('Đã chọn địa chỉ')
        self.page.locator('#checkoutAddress').fill('1 Đường Không Có Thật, Hà Nội')
        expect(self.page.locator('#checkoutAddressResults')).not_to_be_visible()
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutAddressError')).to_contain_text('kiểm tra và chọn')
        expect(self.page.locator('#checkoutReviewDialog')).not_to_be_visible()
        self.assertIsNone(self.state())
        self.page.locator('#checkoutFulfillment').select_option('pickup')
        self.place_order()
        self.assertIsNone(self.state()['orders'][0]['deliveryLocation'])
        self.assertEqual(self.state()['orders'][0]['shipping'], 0)

    def test_address_service_failure_blocks_delivery_and_can_be_retried(self):
        self.demo_checkout()
        self.page.locator('#checkoutFulfillment').select_option('delivery')
        self.page.route('https://nominatim.openstreetmap.org/search**', lambda route: route.fulfill(status=503, json={}))
        self.page.locator('#verifyDeliveryAddress').click()
        expect(self.page.locator('#checkoutAddressError')).to_contain_text('Chưa kết nối được')
        expect(self.page.locator('#verifyDeliveryAddress')).to_be_enabled()
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutReviewDialog')).not_to_be_visible()
        self.assertIsNone(self.state())
        self.page.unroute('https://nominatim.openstreetmap.org/search**')
        self.verify_delivery_address()
        self.place_order()
        expect(self.page.locator('#invoiceContent')).to_contain_text(DELIVERY_ADDRESS['display_name'])

    def test_late_address_result_cannot_verify_a_changed_address(self):
        self.demo_checkout()
        self.page.locator('#checkoutFulfillment').select_option('delivery')
        pending = []
        self.page.route('https://nominatim.openstreetmap.org/search**', lambda route: pending.append(route))
        with self.page.expect_request('https://nominatim.openstreetmap.org/search**'):
            self.page.locator('#verifyDeliveryAddress').click()
        self.page.evaluate('() => new Promise(resolve => requestAnimationFrame(resolve))')
        self.assertTrue(pending)
        self.page.locator('#checkoutAddress').fill('888 Địa Chỉ Khác, Hà Nội')
        pending[0].fulfill(json=[DELIVERY_ADDRESS])
        expect(self.page.locator('#checkoutAddressStatus')).to_be_empty()
        expect(self.page.locator('#checkoutAddressResults')).not_to_be_visible()
        self.page.locator('#confirmCheckout').click()
        expect(self.page.locator('#checkoutAddressError')).to_contain_text('kiểm tra và chọn')
        self.assertIsNone(self.state())

    def test_stock_is_rechecked_after_the_customer_has_opened_review(self):
        self.demo_checkout()
        self.page.locator('#cartQuantity0').fill('29')
        self.page.locator('#confirmCheckout').click()
        other = self.context.new_page()
        other.goto(self.base)
        self.demo_checkout(other)
        self.place_order(other)
        self.page.locator('#placeReviewedOrder').click()
        expect(self.page.locator('#checkoutReviewError')).to_contain_text('không đủ tồn kho')
        expect(self.page.locator('#invoiceDialog')).not_to_be_visible()
        self.assertEqual(len(self.state()['orders']), 1)
        self.assertEqual(self.state()['inventories']['demo-an-tam'][0]['stock'], 28)

    def test_medicine_search_preserves_selected_items_and_does_not_submit_on_enter(self):
        self.demo_checkout()
        search = self.page.locator("#checkoutMedicineSearch")
        products = self.page.locator(".checkout-product:visible")
        search.fill("  NUOC   MUOI  ")
        expect(products).to_have_count(1)
        expect(products).to_contain_text("Nước muối sinh lý")
        search.press("Enter")
        expect(self.page.locator("#checkoutDialog")).to_be_visible()
        expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
        self.assertIsNone(self.state())
        products.locator('[data-quantity-step="1"]').click()
        expect(self.page.locator("#checkoutTotal")).to_have_text("71.000 ₫")
        search.fill("500mg")
        expect(products).to_have_count(1)
        expect(products).to_contain_text("Vitamin C")
        expect(self.page.locator("#cartQuantity1")).to_have_value("1")
        search.fill("không có sản phẩm này")
        expect(products).to_have_count(0)
        expect(self.page.locator("#checkoutSearchEmpty")).to_be_visible()
        expect(self.page.locator("#checkoutSearchStatus")).to_contain_text("0 / 6")
        expect(self.page.locator("#checkoutTotal")).to_have_text("71.000 ₫")
        self.page.locator("#clearCheckoutSearch").click()
        expect(search).to_be_focused()
        expect(products).to_have_count(6)
        expect(self.page.locator("#cartQuantity0")).to_have_value("3")
        search.fill("rửa tay")
        expect(products).to_have_count(1)
        expect(products.locator("input")).to_be_disabled()
        search.fill("VITAMIN")
        self.place_order()
        expect(self.page.locator("#invoiceContent")).to_contain_text("71.000 ₫")
        self.assertEqual([item["quantity"] for item in self.state()["orders"][0]["items"]], [3, 1])

    def test_search_reveals_invalid_hidden_quantity_and_resets_when_reopened(self):
        self.demo_checkout()
        search = self.page.locator("#checkoutMedicineSearch")
        self.page.locator("#cartQuantity0").fill("31")
        search.fill("vitamin")
        expect(self.page.locator("#cartQuantity0")).not_to_be_visible()
        self.page.locator("#confirmCheckout").click()
        expect(search).to_have_value("")
        expect(self.page.locator("#cartQuantity0")).to_be_visible()
        self.assertFalse(self.page.locator("#cartQuantity0").evaluate("input => input.checkValidity()"))
        self.assertIsNone(self.state())
        self.page.locator("#cartQuantity0").fill("0")
        search.fill("điện tử")
        expect(self.page.locator(".checkout-product:visible")).to_have_count(1)
        self.page.locator("#checkoutDialog [data-close-dialog]").click()
        self.page.locator("#pharmacyList .order-button").nth(1).click()
        expect(search).to_have_value("")
        expect(self.page.locator(".checkout-product:visible")).to_have_count(6)
        expect(self.page.locator("#checkoutTotal")).to_have_text("0 ₫")
        expect(self.page.locator("#confirmCheckout")).to_be_disabled()

    def test_delivery_invoice_download_print_and_persistence(self):
        self.demo_checkout()
        expect(self.page.locator("#checkoutTotal")).to_have_text("59.000 ₫")
        expect(self.page.locator("#cartQuantity5")).to_be_disabled()
        self.page.locator("#checkoutFulfillment").select_option("delivery")
        expect(self.page.locator("#checkoutTotal")).to_have_text("74.000 ₫")
        unsafe_name = '<img src=x onerror="window.xss=1">'
        self.page.locator("#checkoutName").fill(unsafe_name)
        self.page.locator("#checkoutNote").fill("<script>window.xss=2</script>")
        self.verify_delivery_address()
        self.place_order()
        expect(self.page.locator("#invoiceDialog")).to_be_visible()
        expect(self.page.locator("#invoiceContent")).to_contain_text("74.000 ₫")
        expect(self.page.locator("#invoiceContent")).to_contain_text(unsafe_name)
        expect(self.page.locator("#invoiceContent img, #invoiceContent script")).to_have_count(0)
        state = self.state()
        self.assertEqual(len(state["orders"]), 1)
        order = state["orders"][0]
        self.assertEqual([item["quantity"] for item in order["items"]], [2, 1])
        self.assertEqual((order["subtotal"], order["shipping"], order["total"]), (59000, 15000, 74000))
        self.assertEqual([item["stock"] for item in state["inventories"]["demo-an-tam"]][:2], [28, 19])
        self.assertEqual(order["paymentStatus"], "Chưa thanh toán")
        with tempfile.TemporaryDirectory() as directory:
            with self.page.expect_download() as download_info:
                self.page.locator("#downloadInvoice").click()
            download = download_info.value
            self.assertTrue(download.suggested_filename.endswith(".html"))
            filename = Path(directory) / download.suggested_filename
            download.save_as(filename)
            exported = filename.read_text()
            self.assertIn("74.000 ₫", exported)
            self.assertIn("&lt;script&gt;window.xss=2&lt;/script&gt;", exported)
            self.assertNotIn("<script>", exported)
            self.assertIn("Đã xác nhận · Demo", exported)
            self.assertIn("Thanh toán trực tiếp khi nhận hàng (COD)", exported)
            confirmed = self.state()["orders"][0]
            self.assertEqual(confirmed["status"], "Đã xác nhận · Demo")
            self.assertEqual(confirmed["invoicePreference"], "download")
            self.assertTrue(confirmed["confirmedAt"])
            self.assertEqual(confirmed["paymentStatus"], "Chưa thanh toán")
            self.assertEqual(self.state()["inventories"], state["inventories"])
            expect(self.page.locator(".invoice-status.is-confirmed")).to_have_text("Đã xác nhận · Demo")
            # Run the print action and separately exercise the browser's print layout.
            self.page.evaluate("window.print = () => { window.printRequested = true; }")
            self.page.locator("#printInvoice").click()
            self.assertTrue(self.page.evaluate("window.printRequested"))
            self.assertEqual(self.state()["orders"][0]["confirmedAt"], confirmed["confirmedAt"])
            self.assertEqual(self.state()["orders"][0]["invoicePreference"], "print")
            self.assertEqual(len(self.state()["orders"]), 1)
            self.page.emulate_media(media="print")
            expect(self.page.locator("main")).to_be_hidden()
            expect(self.page.locator("#invoiceContent")).to_be_visible()
            expect(self.page.locator("#invoiceDialog .shop-dialog-footer")).to_be_hidden()
            self.assertTrue(self.page.pdf(format="A4").startswith(b"%PDF"))
        self.page.emulate_media(media="screen")
        self.page.reload()
        self.page.locator("#checkoutHistoryButton").click()
        expect(self.page.locator(".checkout-history-order")).to_have_count(1)
        expect(self.page.locator(".checkout-history-order .demo-badge")).to_have_text("Đã xác nhận · Demo")
        self.page.get_by_role("button", name="Xem hóa đơn", exact=True).click()
        expect(self.page.locator("#invoiceContent")).to_contain_text(order["id"])
        expect(self.page.locator("#invoiceContent")).to_contain_text("74.000 ₫")
        expect(self.page.locator(".invoice-status.is-confirmed")).to_be_visible()
        self.page.locator("#invoiceDialog [data-close-dialog]").click()
        self.demo_checkout()
        expect(self.page.locator("#cartQuantity0")).to_have_attribute("max", "28")

    def test_declining_invoice_confirms_cod_order_without_downloading(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        downloads = []
        self.page.on("download", lambda download: downloads.append(download))
        self.demo_checkout()
        self.place_order()
        original = self.state()
        self.page.locator("#declineInvoice").click()
        expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
        expect(self.page.locator("#checkoutFeedback")).to_contain_text("Đơn hàng demo đã được xác nhận")
        expect(self.page.locator("#checkoutFeedback")).to_contain_text("không nhận hóa đơn")
        order = self.state()["orders"][0]
        self.assertEqual(order["status"], "Đã xác nhận · Demo")
        self.assertEqual(order["invoicePreference"], "none")
        self.assertTrue(order["confirmedAt"])
        self.assertEqual(order["paymentStatus"], "Chưa thanh toán")
        self.assertEqual(self.state()["inventories"], original["inventories"])
        self.assertEqual(downloads, [])
        self.page.reload()
        self.page.locator("#checkoutHistoryButton").click()
        expect(self.page.locator(".checkout-history-order")).to_have_count(1)
        expect(self.page.locator(".checkout-history-order")).to_contain_text("Đã xác nhận · Demo")
        expect(self.page.locator(".checkout-history-order")).to_contain_text("Hóa đơn: Không nhận")
        self.page.get_by_role("button", name="Xem hóa đơn", exact=True).click()
        expect(self.page.locator("#invoiceActionStatus")).to_contain_text("không nhận hóa đơn")
        expect(self.page.locator("#downloadInvoice")).to_be_enabled()
        self.assertLessEqual(self.page.locator("#invoiceDialog").evaluate("e => e.scrollWidth-e.clientWidth"), 1)

    def test_print_confirms_cod_order_before_opening_print_dialog(self):
        self.demo_checkout()
        self.page.locator("#checkoutFulfillment").select_option("delivery")
        self.verify_delivery_address()
        self.place_order()
        self.page.evaluate("""key => {
          window.print = () => {
            window.printedOrder = JSON.parse(localStorage.getItem(key)).orders[0];
            window.printedContent = document.querySelector('#invoiceContent').textContent;
          };
        }""", STORAGE_KEY)
        self.page.locator("#printInvoice").click()
        printed = self.page.evaluate("window.printedOrder")
        self.assertEqual(printed["status"], "Đã xác nhận · Demo")
        self.assertEqual(printed["invoicePreference"], "print")
        self.assertEqual(printed["paymentStatus"], "Chưa thanh toán")
        self.assertIn("Đã xác nhận · Demo", self.page.evaluate("window.printedContent"))
        self.assertIn("Thanh toán trực tiếp khi nhận hàng (COD)", self.page.evaluate("window.printedContent"))

    def test_invoice_choice_storage_failure_does_not_claim_choice_was_saved(self):
        self.demo_checkout()
        self.place_order()
        original = self.state()
        downloads = []
        self.page.on("download", lambda download: downloads.append(download))
        self.page.evaluate("""key => {
          window.originalCheckoutWrite = Storage.prototype.setItem;
          Storage.prototype.setItem = function(k,v) {
            if (k===key) throw new DOMException('Full','QuotaExceededError');
            return window.originalCheckoutWrite.call(this,k,v);
          };
          window.print = () => { window.printRequested = true; };
        }""", STORAGE_KEY)
        for action in ["downloadInvoice", "printInvoice", "declineInvoice"]:
            with self.subTest(action=action):
                self.page.locator("#"+action).click()
                expect(self.page.locator("#invoiceError")).to_contain_text("Chưa thể lưu lựa chọn hóa đơn")
                expect(self.page.locator("#invoiceDialog")).to_be_visible()
                expect(self.page.locator(".invoice-status.is-confirmed")).to_have_count(1)
                self.assertEqual(self.state(), original)
        self.assertEqual(downloads, [])
        self.assertFalse(self.page.evaluate("Boolean(window.printRequested)"))
        self.page.evaluate("() => { Storage.prototype.setItem = window.originalCheckoutWrite; }")
        self.page.locator("#declineInvoice").click()
        expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
        self.assertEqual(self.state()["orders"][0]["status"], "Đã xác nhận · Demo")

    def test_invoice_confirmation_preserves_orders_placed_in_another_tab(self):
        self.demo_checkout()
        self.place_order()
        first = self.state()["orders"][0]
        other = self.context.new_page()
        other.goto(self.base)
        self.demo_checkout(other)
        self.place_order(other)
        before = self.state()
        self.page.locator("#declineInvoice").click()
        after = self.state()
        self.assertEqual(len(after["orders"]), 2)
        self.assertEqual(after["inventories"], before["inventories"])
        self.assertEqual(after["orders"][0], before["orders"][0])
        self.assertEqual(after["orders"][1]["id"], first["id"])
        self.assertEqual(after["orders"][1]["status"], "Đã xác nhận · Demo")

    def test_validation_and_pickup_without_delivery_address(self):
        self.demo_checkout()
        for quantity in ["31", "-1", "1.5"]:
            self.page.locator("#cartQuantity0").fill(quantity)
            self.page.locator("#confirmCheckout").click()
            expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
            self.assertIsNone(self.state())
        self.page.locator("#cartQuantity0").fill("2")
        self.page.locator("#checkoutPhone").fill("abcdefghij")
        self.page.locator("#confirmCheckout").click()
        self.assertFalse(self.page.locator("#checkoutPhone").evaluate("input => input.checkValidity()"))
        self.page.locator("#checkoutPhone").fill("0901234567")
        self.page.locator("#checkoutName").fill("   ")
        self.page.locator("#confirmCheckout").click()
        expect(self.page.locator("#checkoutError")).to_contain_text("họ tên")
        self.page.locator("#checkoutName").fill("Khách nhận tại quầy")
        self.page.locator("#checkoutFulfillment").select_option("delivery")
        self.page.locator("#checkoutAddress").fill("")
        self.page.locator("#confirmCheckout").click()
        self.assertIsNone(self.state())
        self.page.locator("#checkoutFulfillment").select_option("pickup")
        self.page.locator("#confirmCheckout").click()
        self.assertIsNone(self.state())
        self.page.locator("#placeReviewedOrder").dblclick()
        expect(self.page.locator("#invoiceDialog")).to_be_visible()
        self.assertEqual(len(self.state()["orders"]), 1)
        self.assertEqual(self.state()["orders"][0]["shipping"], 0)
        self.assertEqual(self.state()["orders"][0]["total"], 59000)

    def test_stock_rechecked_before_confirming_another_open_cart(self):
        self.demo_checkout()
        other = self.context.new_page()
        other.goto(self.base)
        self.demo_checkout(other)
        self.page.locator("#cartQuantity0").fill("29")
        self.place_order()
        other.locator("#confirmCheckout").click()
        expect(other.locator("#checkoutError")).to_contain_text("không đủ tồn kho")
        expect(other.locator("#invoiceDialog")).not_to_be_visible()
        self.assertEqual(len(self.state()["orders"]), 1)
        self.assertEqual(self.state()["inventories"]["demo-an-tam"][0]["stock"], 1)
        self.assertNotIn("demo-minh-an", self.state()["inventories"])

    def test_storage_failure_never_claims_order_success(self):
        self.demo_checkout()
        self.page.evaluate("""key => {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function(k, v) {
            if (k === key) throw new DOMException('Full', 'QuotaExceededError');
            return set.call(this, k, v);
          };
        }""", STORAGE_KEY)
        self.page.locator("#confirmCheckout").click()
        self.page.locator("#placeReviewedOrder").click()
        expect(self.page.locator("#checkoutReviewError")).to_contain_text("Đơn chưa được tạo")
        expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
        self.assertIsNone(self.state())

    def test_corrupt_storage_is_preserved(self):
        self.page.evaluate("key => localStorage.setItem(key, '{bad-json')", STORAGE_KEY)
        self.demo_checkout()
        expect(self.page.locator("#checkoutError")).to_contain_text("Không đọc được dữ liệu")
        expect(self.page.locator("#confirmCheckout")).to_be_disabled()
        self.assertEqual(self.page.evaluate("key => localStorage.getItem(key)", STORAGE_KEY), "{bad-json")

    def mock_search(self, table_handler):
        self.page.route("https://overpass-api.de/**", lambda route: route.fulfill(json={"elements": [
            {"id": 1, "type": "node", "lat": 21.0286, "lon": 105.8543, "tags": {"amenity": "pharmacy", "name": "Gần theo đường thẳng"}},
            {"id": 2, "type": "node", "lat": 21.032, "lon": 105.858, "tags": {"amenity": "pharmacy", "name": "Gần theo đường bộ"}},
            {"id": 3, "type": "node", "lat": 21.038, "lon": 105.859, "tags": {"amenity": "pharmacy", "name": "Không có tuyến"}},
        ]}))
        self.page.route("https://router.project-osrm.org/table/**", table_handler)

    def test_road_distance_sorting_null_route_and_order_button(self):
        urls = []

        def table(route):
            urls.append(route.request.url)
            route.fulfill(json={"code": "Ok", "distances": [[4200, 900, None]], "durations": [[1000, 180, None]]})

        self.mock_search(table)
        self.page.locator("#normal .find-button").click()
        expect(self.page.locator("#resultNote")).to_contain_text("2/3")
        cards = self.page.locator("#pharmacyList article")
        expect(cards.nth(0)).to_contain_text("Gần theo đường bộ")
        expect(cards.nth(0)).to_contain_text("0.90 km")
        expect(cards.nth(1)).to_contain_text("4.20 km")
        expect(cards.nth(2)).to_contain_text("Chưa tìm thấy tuyến đường bộ")
        self.assertNotIn("chim bay", self.page.locator("#pharmacyList").inner_text())
        self.assertIn("sources=0", urls[0])
        self.assertIn("annotations=distance,duration", urls[0])
        expect(cards.nth(0).get_by_role("button", name="Đường đi", exact=True)).to_be_visible()
        cards.nth(0).get_by_role("button", name="Đặt hàng", exact=True).click()
        expect(self.page.locator("#checkoutTitle")).to_contain_text("Gần theo đường bộ")

    def test_failed_distance_service_and_successful_route_retry(self):
        self.mock_search(lambda route: route.fulfill(status=503, body="Unavailable"))
        self.page.route("https://router.project-osrm.org/route/**", lambda route: route.fulfill(json={
            "code": "Ok", "routes": [{"distance": 1600, "duration": 300,
                                       "geometry": {"type": "LineString", "coordinates": [[105.8542, 21.0285], [105.8543, 21.0286]]}}],
        }))
        self.page.locator("#normal .find-button").click()
        expect(self.page.locator("#resultNote")).to_contain_text("0/3")
        self.assertNotIn(" km", self.page.locator("#pharmacyList").inner_text())
        self.page.locator("#pharmacyList .route-button").first.click()
        expect(self.page.locator("#routeStatus")).to_contain_text("1.60 km")
        expect(self.page.locator("#pharmacyList article").first).to_contain_text("1.60 km")

    def test_stale_road_response_cannot_replace_demo_results(self):
        pending = []
        self.mock_search(lambda route: pending.append(route))
        self.page.locator("#normal .find-button").click()
        expect(self.page.locator("#pharmacyList article")).to_have_count(3)
        self.page.wait_for_function("document.querySelector('#pharmacyList').textContent.includes('Đang tính')")
        self.page.locator("#loadOrderDemo").click()
        self.assertTrue(pending)
        pending[0].fulfill(json={"code": "Ok", "distances": [[4200, 900, None]], "durations": [[1000, 180, None]]})
        # Wait for the routed promise to finish before asserting it did not replace demo state.
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        expect(self.page.locator("#pharmacyList article").first).to_contain_text("Nhà thuốc An Tâm")
        expect(self.page.locator("#resultNote")).to_contain_text("3 nhà thuốc mẫu")

    def test_mobile_order_invoice_and_keyboard_close(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.demo_checkout()
        self.page.locator("#checkoutMedicineSearch").fill("muối")
        expect(self.page.locator(".checkout-product:visible")).to_have_count(1)
        self.assertLessEqual(self.page.locator("#checkoutDialog").evaluate("e => e.scrollWidth - e.clientWidth"), 1)
        self.place_order()
        expect(self.page.locator("#invoiceDialog")).to_be_visible()
        self.assertLessEqual(self.page.locator("#invoiceDialog").evaluate("e => e.scrollWidth - e.clientWidth"), 1)
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#invoiceDialog")).not_to_be_visible()
        self.assertTrue(self.state()["orders"][0]["confirmedAt"])
        self.page.locator("#checkoutHistoryButton").click()
        expect(self.page.locator(".checkout-history-order")).to_have_count(1)

    def test_logged_in_customer_can_return_search_and_reopen_invoice(self):
        customer = {"name": "Khách đăng nhập", "email": "customer@example.test", "role": "customer"}
        self.page.evaluate("customer => sessionStorage.setItem('smartPharmacyActiveCustomer', JSON.stringify(customer))", customer)
        self.page.reload()
        expect(self.page.locator("#customerDashboard")).to_be_visible()
        self.page.locator("#backToSearchButton").click()
        self.assertEqual(self.page.evaluate("JSON.parse(sessionStorage.smartPharmacyActiveCustomer).email"), customer["email"])
        self.demo_checkout()
        expect(self.page.locator("#checkoutEmail")).to_have_value(customer["email"])
        self.place_order()
        self.page.reload()
        expect(self.page.locator("#customerHistoryCount")).to_have_text("1 đơn")
        self.page.locator("#customerOrderHistory").get_by_role("button", name="Xem hóa đơn").click()
        expect(self.page.locator("#invoiceContent")).to_contain_text(customer["email"])
        self.page.locator("#declineInvoice").click()
        expect(self.page.locator("#customerOrderHistory .order-status")).to_have_text("Đã xác nhận · Demo")

    def test_api_orders_use_server_invoice_snapshots_and_keep_demo_storage_separate(self):
        user = {"id": "customer-1", "name": "API Customer", "email": "api@example.test", "role": "CUSTOMER"}
        store = {"id": 101, "name": "API Pharmacy", "address": "12 API Test Street"}
        order = {"id": 901, "status": "pending", "pharmacy": store, "customer": user,
                 "phone": "0901234567", "shippingAddress": "20 Customer Street",
                 "createdAt": "2026-11-15T01:00:00Z", "totalAmount": "34000.00",
                 "items": [{"drugId": 7, "name": "API Medicine", "quantity": 2, "unitPrice": "17000.00"}]}
        created = []
        requests = []

        def api(route):
            path = route.request.url.split(self.base)[1]
            requests.append(path)
            self.assertEqual(route.request.headers.get("authorization"), "Bearer test-api-session")
            if path == "/api/v1/me":
                route.fulfill(json={"data": {"user": user}})
            elif path.startswith("/api/pharmacies?"):
                route.fulfill(json={"data": [store], "pagination": {"total": 1}})
            elif path.startswith("/api/pharmacies/101/inventory"):
                route.fulfill(json={"data": [{"medicine_id": 7, "name": "API Medicine", "price": "17000.00", "quantity": 10, "is_prescription": False}], "pagination": {"total": 1}})
            elif path == "/api/orders" and route.request.method == "POST":
                created.append(route.request.post_data_json)
                route.fulfill(status=201, json=order)
            elif path.startswith("/api/orders?"):
                route.fulfill(json={"items": [order] if created else [], "total": len(created)})
            elif path == "/api/orders/901":
                route.fulfill(json=order)
            else:
                route.fulfill(status=404, json={"message": "Unknown fixture endpoint"})

        self.page.route(self.base + "/runtime-config.js", lambda route: route.fulfill(
            body='window.SMART_PHARMACY_CONFIG = {apiBaseUrl: ""};', content_type="application/javascript"))
        self.page.route(self.base + "/api/**", api)
        self.page.evaluate("session => sessionStorage.setItem('smartPharmacyApiSession_v1', JSON.stringify(session))",
                           {"user": user, "accessToken": "test-api-session"})
        self.page.reload()
        self.page.locator("#apiStoreSearch input").fill("API Pharmacy")
        self.page.locator("#apiStoreSearch button").click()
        self.page.locator("#apiStoreResults button").click()
        self.page.locator("#apiOrderForm [name=quantity]").fill("2")
        self.page.locator("#apiOrderForm [name=shippingAddress]").fill("20 Customer Street")
        self.page.locator("#apiOrderForm [name=phone]").fill("0901234567")
        self.page.locator("#apiOrderForm button").click()
        expect(self.page.locator("#invoiceDialog")).to_be_visible()
        expect(self.page.locator("#invoiceContent")).to_contain_text("34.000 ₫")
        expect(self.page.locator("#invoiceContent")).to_contain_text("API Medicine")
        expect(self.page.locator("#declineInvoice")).not_to_be_visible()
        self.assertNotIn("HÓA ĐƠN DEMO", self.page.locator("#invoiceContent").inner_text())
        self.assertEqual(created, [{"pharmacyId": 101, "items": [{"drugId": 7, "quantity": 2}],
                                    "shippingAddress": "20 Customer Street", "phone": "0901234567"}])
        self.assertIsNone(self.state())
        self.page.evaluate("window.print = () => {}")
        self.page.locator("#printInvoice").click()
        self.assertIsNone(self.state())
        expect(self.page.locator("#invoiceContent")).to_contain_text("Chưa ghi nhận thanh toán")
        self.page.locator("#invoiceDialog [data-close-dialog]").click()
        self.page.reload()
        self.page.locator("#customerOrderHistory [data-api-invoice]").click()
        expect(self.page.locator("#invoiceContent")).to_contain_text("34.000 ₫")
        self.assertIn("/api/orders/901", requests)


if __name__ == "__main__":
    unittest.main()
