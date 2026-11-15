"""Browser regression tests; only external search responses and map tiles are simulated.

See README.md for Playwright and Leaflet test setup.
"""
import os
import base64
import json
import re
import shutil
import tarfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Error, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "docs"
LEAFLET = Path(os.environ.get("LEAFLET_TARBALL", "/tmp/leaflet-1.9.4.tgz"))
PHARMACIES = {"elements": [
    {"type": "node", "id": 1, "lat": 21.0281, "lon": 105.8341,
     "tags": {"amenity": "pharmacy", "name": "Nhà thuốc gần nhất"}},
    {"type": "way", "id": 2, "center": {"lat": 21.029, "lon": 105.835},
     "tags": {"healthcare": "pharmacy", "name": "Nhà thuốc trong tòa nhà"}},
    {"type": "relation", "id": 3, "center": {"lat": 21.03, "lon": 105.836},
     "tags": {"amenity": "pharmacy", "name": "Nhà thuốc thứ ba"}},
]}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class PharmacySearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not LEAFLET.is_file():
            raise RuntimeError("Set LEAFLET_TARBALL to the leaflet@1.9.4 npm tarball; see README.md")
        with tarfile.open(LEAFLET) as archive:
            cls.leaflet = {
                name.removeprefix("package/dist/"): archive.extractfile(name).read()
                for name in archive.getnames()
                if name.startswith("package/dist/") and archive.getmember(name).isfile()
            }
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"),
            headless=True, args=["--no-sandbox"],
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(
            geolocation={"latitude": 21.028, "longitude": 105.834}, permissions=["geolocation"]
        )
        self.page = self.context.new_page()
        self.page.add_init_script("""(() => {
            const locate = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
            window.locationRequests = 0;
            navigator.geolocation.getCurrentPosition = (...args) => {
                window.locationRequests++;
                return locate(...args);
            };
        })();""")
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.diagnostics = []
        self.page.on("console", self.capture_diagnostics)
        self.requests = []
        self.geocode_requests = 0
        self.held = []
        self.failures = []
        self.page.on("requestfailed", lambda request: self.failures.append(request.url))
        self.primary = "success"
        self.backup = "success"
        self.payload = PHARMACIES
        self.backup_payload = None
        self.catalog = None
        self.catalog_mode = "ready"
        self.serve_real_catalog = False
        self.catalog_held = []
        self.geocode = [{"lat": "21.028", "lon": "105.834", "type": "house", "display_name": "Hà Nội"}]
        self.ocr_text = "ĐƠN THUỐC\nHọ tên: Nguyễn Văn A\n1. Paracetamol 500mg\nUống khi sốt\n2. Vitamin C 500mg"
        self.real_ocr = False
        self.ocr_confidence = 95
        self.ocr_readings = None
        self.api_stock = None
        self.stock_requests = []
        self.context.route("**/*", self.route)
        self.page.goto(self.base, wait_until="networkidle")
        expect(self.page.locator(".panel#normal .find-button")).to_be_enabled()

    def tearDown(self):
        # Finish deliberately stalled routes, including requests canceled by the app's AbortController.
        for route in self.held + self.catalog_held:
            try:
                route.abort()
            except Error:
                pass
        self.context.unroute_all(behavior="ignoreErrors")
        self.context.close()
        self.assertEqual(self.errors, [])

    def capture_diagnostics(self, message):
        if message.type == "warning" and message.text.startswith("[Smart Pharmacy] Overpass search failed"):
            self.diagnostics.append(message.args[1].json_value())

    def route(self, route):
        url = route.request.url
        if url == self.base + "/runtime-config.js" and self.api_stock is not None:
            route.fulfill(body='window.SMART_PHARMACY_CONFIG = {apiBaseUrl: ""};', content_type="text/javascript")
        elif url == self.base + "/api/search/pharmacies":
            body = route.request.post_data_json
            self.stock_requests.append(body)
            # Deliberately paginate one row at a time to catch clients returning just the first page.
            page = body["page"]
            route.fulfill(json={"data": self.api_stock[page - 1:page], "pagination": {"total": len(self.api_stock)}})
        elif url.startswith("https://cdn.jsdelivr.net/npm/"):
            if self.real_ocr:
                asset = Path(os.environ["PRESCRIPTION_OCR_ASSET_DIR"]) / url.rsplit("/", 1)[1]
                mime = "text/javascript" if asset.name.endswith(".js") else "application/wasm" if asset.name.endswith(".wasm") else "application/octet-stream"
                route.fulfill(body=asset.read_bytes(), content_type=mime, headers={"Access-Control-Allow-Origin": "*"})
            elif url.endswith("/dist/tesseract.min.js"):
                # Simulate OCR only in deterministic UI tests. The optional real-engine test uses original assets.
                route.fulfill(content_type="text/javascript", body="""
window.Tesseract = {createWorker: async () => ({
  recognize: async (image,options) => {
    if (window.failPrescriptionOcr) throw new Error('Unreadable image');
    window.prescriptionOcrPasses = (window.prescriptionOcrPasses || 0) + 1;
    (window.prescriptionOcrOptions ||= []).push(options);
    const readings = %s;
    const result = {data: readings ? readings[Math.min(window.prescriptionOcrPasses-1,readings.length-1)] : {text: %s, confidence: %s}};
    if (window.holdPrescriptionOcr) return new Promise(resolve => {window.finishPrescriptionOcr = () => resolve(result)});
    return result;
  },
  terminate: async () => { window.prescriptionWorkerTerminated = true; }
})};""" % (json.dumps(self.ocr_readings), json.dumps(self.ocr_text), self.ocr_confidence))
            else:
                route.fulfill(body=b"\0", headers={"Access-Control-Allow-Origin": "*"})
        elif url.startswith(self.base + "/data/pharmacies/index.json") and self.serve_real_catalog:
            route.continue_()
        elif url.startswith(self.base + "/data/pharmacies/index.json") and self.catalog is None:
            # API regression tests must not depend on whether production snapshots were generated.
            route.fulfill(json={"version": 1, "datasets": []})
        elif url.startswith(self.base + "/data/pharmacies/index.json") and self.catalog is not None:
            route.fulfill(json={"version": 1, "datasets": [{
                "id": "test", "file": "test-catalog.json", "bounds": self.catalog["bounds"],
                "generatedAt": self.catalog["generatedAt"]
            }]})
        elif url.startswith(self.base + "/data/pharmacies/test-catalog.json"):
            if self.catalog_mode == "hold":
                self.catalog_held.append(route)
            else:
                route.fulfill(json=self.catalog)
        elif url.startswith(self.base):
            route.continue_()
        elif url.startswith("https://unpkg.com/leaflet@1.9.4/dist/"):
            name = url.split("/dist/", 1)[1]
            content_type = "text/javascript" if name.endswith(".js") else "text/css" if name.endswith(".css") else "image/png"
            route.fulfill(body=self.leaflet[name], content_type=content_type)
        elif "/api/interpreter" in url:
            host = urlparse(url).hostname
            self.requests.append((host, parse_qs(route.request.post_data)["data"][0]))
            mode = self.primary if host == "overpass-api.de" else self.backup
            payload = self.payload if host == "overpass-api.de" or self.backup_payload is None else self.backup_payload
            if mode == "hold":
                self.held.append(route)
            elif mode == "http_error":
                route.fulfill(status=503, body="busy")
            elif mode == "rate_limited":
                route.fulfill(status=429, body="too many requests")
            elif mode == "remark":
                route.fulfill(json={"elements": [], "remark": "runtime error: Query timed out"})
            elif mode == "partial":
                route.fulfill(json={**payload, "remark": "runtime error: Query timed out"})
            elif mode == "missing_coordinates":
                route.fulfill(json={"elements": [{"type": "node", "id": 1, "tags": {"name": "Missing coordinates"}}]})
            elif mode == "empty":
                route.fulfill(json={"elements": []})
            else:
                route.fulfill(json=payload)
        elif "nominatim.openstreetmap.org" in url:
            self.geocode_requests += 1
            route.fulfill(json=self.geocode)
        elif "router.project-osrm.org/table/" in url:
            count = len(parse_qs(urlparse(url).query)["destinations"][0].split(";"))
            route.fulfill(json={"code": "Ok", "distances": [[1200 + index * 200 for index in range(count)]],
                                "durations": [[300 + index * 30 for index in range(count)]]})
        elif "router.project-osrm.org" in url:
            route.fulfill(json={"code": "Ok", "routes": [{"distance": 1200, "duration": 300, "geometry": {
                "type": "LineString", "coordinates": [[105.834, 21.028], [105.8341, 21.0281]]
            }}]})
        else:
            route.abort()

    def find(self):
        self.page.locator(".panel#normal .find-button").click()

    def completed(self, count=3):
        expect(self.page.locator("#results")).to_have_attribute("aria-busy", "false")
        expect(self.page.locator("#pharmacyList article")).to_have_count(count)
        expect(self.page.locator(".panel#normal .find-button")).to_be_enabled()

    def wait_requests(self, count):
        deadline = time.monotonic() + 5
        while len(self.requests) < count and time.monotonic() < deadline:
            self.page.wait_for_timeout(10)
        self.assertEqual(len(self.requests), count)

    def test_bbox_query_covers_both_tags_and_all_geometry_types(self):
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 1)
        query = self.requests[0][1]
        self.assertIn('nwr["amenity"="pharmacy"]', query)
        self.assertIn('nwr["healthcare"="pharmacy"]', query)
        self.assertIn('nwr["shop"~"^(pharmacy|drugstore|chemist)$"]', query)
        self.assertNotIn('[~"^(name|', query)
        self.assertIn("out center tags;", query)
        self.assertIn("[timeout:25]", query)
        self.assertNotIn("around:", query)
        south, west, north, east = map(float, re.search(r'\["amenity"="pharmacy"\]\(([^)]+)\)', query)[1].split(","))
        self.assertLess(south, 21.028)
        self.assertGreater(north, 21.028)
        self.assertLess(west, 105.834)
        self.assertGreater(east, 105.834)
        expect(self.page.locator("#pharmacyList h3").first).to_have_text("Nhà thuốc gần nhất")
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(3)
        expect(self.page.locator("#pharmacyResultSummary")).to_contain_text("3 nhà thuốc")
        self.page.locator(".route-button").first.click()
        expect(self.page.locator("#routeStatus")).to_contain_text("1.20 km")

    def test_slow_primary_uses_backup_and_cancels_losing_request(self):
        self.page.clock.install()
        self.primary = "hold"
        self.find()
        self.wait_requests(1)
        expect(self.page.locator('#pharmacyList [data-state="loading"]')).to_be_visible()
        expect(self.page.locator("#map.leaflet-container")).to_be_visible()
        self.page.locator(".panel#normal .find-button").dispatch_event("click")
        self.assertEqual(len(self.requests), 1)
        self.page.clock.fast_forward(4001)
        self.completed()
        self.assertEqual([host for host, _ in self.requests], ["overpass-api.de", "overpass.private.coffee"])
        self.assertTrue(any("overpass-api.de" in url for url in self.failures))

    def test_fast_primary_does_not_contact_backup(self):
        self.page.clock.install()
        self.find()
        self.completed()
        self.page.clock.fast_forward(5000)
        self.assertEqual(len(self.requests), 1)

    def test_failed_primary_uses_backup_immediately(self):
        self.primary = "http_error"
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 2)

    def test_missing_coordinates_trigger_backup_instead_of_false_empty(self):
        self.primary = "missing_coordinates"
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 2)

    def test_both_sources_fail_shows_inline_error_and_retry_works(self):
        self.primary = "remark"
        self.backup = "http_error"
        self.find()
        self.completed(0)
        expect(self.page.locator('#pharmacyList [data-state="error"]')).to_be_visible()
        expect(self.page.locator('#pharmacyList [data-state="empty"]')).to_have_count(0)
        self.primary = "success"
        self.page.locator('[data-pharmacy-search-action="retry"]').click()
        self.completed()
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.page.evaluate("window.locationRequests"), 1)

    def test_total_timeout_is_bounded_and_map_remains_visible(self):
        self.page.clock.install()
        self.primary = self.backup = "hold"
        self.find()
        self.wait_requests(1)
        self.page.clock.fast_forward(4001)
        self.wait_requests(2)
        self.page.clock.fast_forward(41000)
        self.completed(0)
        expect(self.page.locator('#pharmacyList [role="alert"]')).to_contain_text("phản hồi quá lâu")
        expect(self.page.locator("#map.leaflet-container")).to_be_visible()
        expect(self.page.locator('[data-pharmacy-search-action="retry"]')).to_be_enabled()
        self.assertTrue(self.diagnostics[-1]["timedOut"])

    def stream_primary_response(self, delay_ms):
        self.page.evaluate("""({payload, delay}) => {
            const originalFetch = window.fetch;
            window.fetch = async (url, options) => {
                if (String(url).includes('overpass-api.de/api/interpreter')) {
                    window.testReceivedHeaders = true;
                    const stream = new ReadableStream({
                        start(controller) {
                            const timer = setTimeout(() => {
                                controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
                                controller.close();
                            }, delay);
                            options.signal.addEventListener('abort', () => {
                                clearTimeout(timer);
                                controller.error(new DOMException('Request aborted', 'AbortError'));
                            }, {once: true});
                        }
                    });
                    return new Response(stream, {status: 200, headers: {'Content-Type': 'application/json'}});
                }
                return originalFetch(url, options);
            };
        }""", {"payload": self.payload, "delay": delay_ms})

    def test_http_200_body_arriving_after_12_seconds_renders_pharmacies(self):
        self.page.clock.install()
        self.backup = "hold"
        self.stream_primary_response(20000)
        self.find()
        self.page.wait_for_function("window.testReceivedHeaders === true")
        self.page.clock.fast_forward(12001)
        expect(self.page.locator('#pharmacyList [data-state="loading"]')).to_be_visible()
        expect(self.page.locator('#pharmacyList [data-state="error"]')).to_have_count(0)
        expect(self.page.locator('#pharmacyList [data-state="loading"] p')).to_contain_text("đang phản hồi chậm")
        self.page.clock.fast_forward(8000)
        self.completed()
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(3)
        self.assertEqual(self.diagnostics, [])

    def test_http_200_stalled_body_reports_body_timeout(self):
        self.page.clock.install()
        self.backup = "hold"
        self.stream_primary_response(60000)
        self.find()
        self.page.wait_for_function("window.testReceivedHeaders === true")
        self.page.clock.fast_forward(4001)
        self.wait_requests(1)
        self.page.clock.fast_forward(41000)
        self.completed(0)
        expect(self.page.locator('#pharmacyList [role="alert"]')).to_contain_text("45 giây")
        source = self.diagnostics[-1]["sources"][0]
        self.assertEqual(source["status"], 200)
        self.assertEqual(source["stage"], "body")

    def test_partial_valid_results_are_shown_and_not_cached_as_complete(self):
        self.primary = "partial"
        self.backup = "http_error"
        self.find()
        self.completed()
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_be_visible()
        expect(self.page.locator('#pharmacyResultSummary')).to_contain_text("3 nhà thuốc")
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('smartPharmacyMapCache_v3') || '[]')"), [])
        self.primary = "success"
        self.page.locator('[data-pharmacy-search-action="retry"]').click()
        self.completed()
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_have_count(0)
        self.assertEqual(len(self.requests), 3)

    def test_partial_results_outside_radius_do_not_claim_no_pharmacies(self):
        self.primary = "partial"
        self.backup = "http_error"
        self.payload = {"elements": [{"type": "node", "id": 9, "lat": 21.052, "lon": 105.86, "tags": {"amenity": "pharmacy"}}]}
        self.find()
        self.completed(0)
        expect(self.page.locator('#pharmacyList [data-state="error"]')).to_be_visible()
        expect(self.page.locator('#pharmacyList [data-state="empty"]')).to_have_count(0)

    def test_http_failure_status_is_preserved_for_diagnosis(self):
        self.primary = "rate_limited"
        self.backup = "http_error"
        self.find()
        self.completed(0)
        expect(self.page.locator('#pharmacyList [role="alert"]')).to_contain_text("giới hạn lượt truy cập")
        sources = self.diagnostics[-1]["sources"]
        self.assertEqual([source["status"] for source in sources], [429, 503])
        self.assertEqual([source["server"] for source in sources], ["overpass-api.de", "overpass.private.coffee"])

    def test_name_and_shop_tags_include_pharmacies_but_exclude_other_medical_places(self):
        tags = [
            {"shop": "chemist", "name": "Quầy thuốc Minh Tâm"},
            {"shop": "pharmacy", "name": "Minh Anh"},
            {"shop": "chemist", "brand": "FPT Long Châu", "name": "Long Châu"},
            {"shop": "chemist", "name:vi": "NHÀ THUỐC HỒNG HÀ"},
            {"shop": "chemist", "name": "Pharmacity"},
            {"shop": "chemist", "name": "Tiệm thuốc An Bình"},
            {"shop": "drugstore", "name:en": "Thanh Cong Pharmacy"},
            {"shop": "chemist", "brand": "Nhà thuốc Long Châu"},
            {"amenity": "hospital", "name": "Pharmacy Hospital"},
            {"healthcare": "clinic", "name": "Pharmacy Clinic"},
            {"shop": "chemist", "name": "Guardian"},
            {"shop": "cosmetics", "name": "Nhà Thuốc Cosmetics"},
        ]
        self.payload = {"elements": PHARMACIES["elements"] + [
            {"type": "node", "id": 100 + i, "lat": 21.0282 + i * .0001, "lon": 105.8342, "tags": value}
            for i, value in enumerate(tags)
        ]}
        self.find()
        self.completed(11)
        expect(self.page.locator("#pharmacyList")).to_contain_text("Quầy thuốc Minh Tâm")
        expect(self.page.locator("#pharmacyList")).to_contain_text("NHÀ THUỐC HỒNG HÀ")
        expect(self.page.locator("#pharmacyList")).to_contain_text("Thanh Cong Pharmacy")
        expect(self.page.locator("#pharmacyList")).to_contain_text("Nhà thuốc Long Châu")
        for excluded in ["Pharmacy Hospital", "Pharmacy Clinic", "Guardian", "Nhà Thuốc Cosmetics"]:
            expect(self.page.locator("#pharmacyList")).not_to_contain_text(excluded)
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(11)

    def test_partial_first_result_does_not_cancel_more_complete_backup(self):
        self.primary = "partial"
        self.backup = "hold"
        self.payload = {"elements": [PHARMACIES["elements"][0]]}
        self.find()
        self.wait_requests(2)
        expect(self.page.locator("#pharmacyList article")).to_have_count(1)
        expect(self.page.locator("#results")).to_have_attribute("aria-busy", "true")
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_contain_text("Đang tiếp tục tìm")
        self.held.pop().fulfill(json=PHARMACIES)
        self.completed(3)
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_have_count(0)
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(3)

    def test_two_partial_sources_are_merged_without_duplicate_osm_ids(self):
        self.primary = self.backup = "partial"
        self.payload = {"elements": PHARMACIES["elements"][:2]}
        self.backup_payload = {"elements": PHARMACIES["elements"][1:]}
        self.find()
        self.completed(3)
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_be_visible()
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(3)
        self.assertEqual(len(self.requests), 2)

    def test_partial_backup_keeps_waiting_for_complete_primary(self):
        self.page.clock.install()
        self.primary = "hold"
        self.backup = "partial"
        self.backup_payload = {"elements": [PHARMACIES["elements"][0]]}
        self.find()
        self.wait_requests(1)
        self.page.clock.fast_forward(4001)
        self.wait_requests(2)
        expect(self.page.locator("#pharmacyList article")).to_have_count(1)
        expect(self.page.locator("#results")).to_have_attribute("aria-busy", "true")
        self.held.pop().fulfill(json=PHARMACIES)
        self.completed(3)

    def test_partial_result_survives_timeout_of_other_source(self):
        self.page.clock.install()
        self.primary = "partial"
        self.backup = "hold"
        self.payload = {"elements": [PHARMACIES["elements"][0]]}
        self.find()
        self.wait_requests(2)
        expect(self.page.locator("#pharmacyList article")).to_have_count(1)
        self.page.clock.fast_forward(45001)
        self.completed(1)
        expect(self.page.locator('#pharmacyList [data-state="partial"]')).to_be_visible()
        expect(self.page.locator('#pharmacyList [data-state="error"]')).to_have_count(0)

    def test_empty_result_can_expand_radius_without_relocating(self):
        self.primary = "empty"
        self.find()
        self.completed(0)
        expect(self.page.locator('#pharmacyList [data-state="empty"]')).to_be_visible()
        expect(self.page.locator('#pharmacyList a')).to_have_attribute("href", re.compile(r"^https://www.google.com/maps/search/"))
        expand = self.page.locator('[data-pharmacy-search-action="expand"]')
        expect(expand).to_have_text("Mở rộng lên 5 km")
        self.primary = "success"
        expand.click()
        self.completed()
        expect(self.page.locator("#searchRadius")).to_have_value("5000")
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.page.evaluate("window.locationRequests"), 1)

    def test_radius_filter_excludes_bbox_corners_and_invalid_coordinates(self):
        self.payload = {"elements": PHARMACIES["elements"] + [
            {"type": "node", "id": 4, "lat": 21.0365, "lon": 105.843,
             "tags": {"amenity": "pharmacy", "name": "Outside the 1 km circle"}},
            {"type": "node", "id": 5, "lat": "bad", "lon": 105.834, "tags": {"name": "Bad coordinates"}},
        ]}
        self.find()
        self.completed(4)
        self.page.locator("#searchRadius").select_option("1000")
        self.completed(3)
        expect(self.page.locator("#pharmacyList")).not_to_contain_text("Outside")
        self.page.locator("#searchRadius").select_option("3000")
        self.completed(4)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.page.evaluate("window.locationRequests"), 1)

    def test_cache_survives_reload_and_minor_gps_jitter_but_expires(self):
        self.page.clock.install()
        self.find()
        self.completed()
        self.page.reload(wait_until="networkidle")
        self.page.evaluate("() => {navigator.geolocation.getCurrentPosition = success => success({coords: {latitude: 21.028001, longitude: 105.834001}});}")
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 1)
        self.page.clock.fast_forward(24 * 60 * 60 * 1000 + 1)
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 2)

    def test_address_area_radius_change_reuses_geocoded_boundary(self):
        self.geocode[0].update({"type": "administrative", "class": "boundary", "geojson": {
            "type": "Polygon", "coordinates": [[[105.83,21.02],[105.84,21.02],[105.84,21.04],[105.83,21.04],[105.83,21.02]]]
        }})
        self.page.locator("#addressInput").fill("Hà Nội")
        self.page.locator("#addressSearchButton").click()
        self.completed()
        self.page.locator("#searchRadius").select_option("5000")
        self.completed()
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.geocode_requests, 1)
        self.assertEqual(self.page.evaluate("window.locationRequests"), 0)
        expect(self.page.locator("#resultNote")).to_contain_text("ranh giới khu vực")

    def test_retry_refreshes_cached_empty_result(self):
        self.primary = "empty"
        self.find()
        self.completed(0)
        self.primary = "success"
        self.page.locator('[data-pharmacy-search-action="retry"]').click()
        self.completed()
        self.assertEqual(len(self.requests), 2)

    def test_blocked_storage_does_not_break_search(self):
        self.page.add_init_script("""(() => {
            Storage.prototype.getItem = Storage.prototype.setItem = () => {throw new Error('Storage disabled');};
        })();""")
        self.page.reload(wait_until="networkidle")
        self.find()
        self.completed()

    def use_catalog(self, elements=None):
        self.catalog = {
            "version": 1, "complete": True, "bounds": [20, 105, 22, 107],
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "elements": PHARMACIES["elements"] if elements is None else elements,
        }

    def test_first_search_uses_catalog_without_waiting_for_overpass(self):
        # A national snapshot contains many records outside the requested neighborhood.
        self.use_catalog(PHARMACIES["elements"] + [
            {"type": "node", "id": 10000 + i, "lat": 10 + (i % 1000) / 10000,
             "lon": 106 + (i // 1000) / 10000, "tags": {"amenity": "pharmacy", "name": f"Fixture {i}"}}
            for i in range(10000)
        ])
        self.primary = self.backup = "hold"
        self.page.reload(wait_until="networkidle")
        start = time.perf_counter()
        self.find()
        self.completed()
        elapsed = time.perf_counter() - start
        self.assertEqual(self.requests, [])
        self.assertLess(elapsed, 2, "Local catalog search should not wait for a 40s API response")
        expect(self.page.locator("#pharmacyResultSummary")).to_contain_text("Dữ liệu cập nhật")
        print(f"\nCatalog first-search UI (10,003 fixture records): {elapsed * 1000:.0f} ms; Overpass requests: 0", flush=True)

    def test_published_osm_catalog_returns_hanoi_pharmacies_without_overpass(self):
        manifest = json.loads((ROOT / "data/pharmacies/index.json").read_text())
        if not manifest.get("datasets"):
            self.skipTest("Generate a real catalog before running the published-data smoke test")
        self.serve_real_catalog = True
        self.primary = self.backup = "hold"
        self.page.reload(wait_until="networkidle")
        start = time.perf_counter()
        self.find()
        expect(self.page.locator("#results")).to_have_attribute("aria-busy", "false")
        count = self.page.locator("#pharmacyList article").count()
        elapsed = time.perf_counter() - start
        self.assertGreater(count, 0, "The published catalog should contain pharmacies in central Hanoi")
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(count)
        self.assertEqual(self.requests, [])
        self.assertLess(elapsed, 2)
        print(f"\nPublished OSM catalog, Hanoi 3 km: {count} pharmacies, {elapsed * 1000:.0f} ms; Overpass requests: 0", flush=True)

    def test_empty_covered_catalog_does_not_call_slow_api(self):
        self.use_catalog([])
        self.primary = self.backup = "hold"
        self.page.reload(wait_until="networkidle")
        self.find()
        self.completed(0)
        self.assertEqual(self.requests, [])

    def test_catalog_not_covering_search_falls_back_to_api(self):
        self.use_catalog()
        self.catalog["bounds"] = [10, 106, 11, 107]
        self.page.reload(wait_until="networkidle")
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 1)

    def test_partial_catalog_is_rejected_and_live_api_used(self):
        self.use_catalog()
        self.catalog["complete"] = False
        self.page.reload(wait_until="networkidle")
        self.find()
        self.completed()
        self.assertEqual(len(self.requests), 1)

    def test_slow_catalog_does_not_block_live_fallback(self):
        self.use_catalog()
        self.catalog_mode = "hold"
        self.page.reload(wait_until="domcontentloaded")
        self.page.clock.install()
        self.find()
        self.page.clock.fast_forward(1501)
        self.completed()
        self.assertEqual(len(self.requests), 1)

    def test_cache_survives_session_clear_and_reuses_nearby_position(self):
        self.find()
        self.completed()
        self.page.evaluate("sessionStorage.clear()")
        self.page.reload(wait_until="networkidle")
        self.page.evaluate("() => {navigator.geolocation.getCurrentPosition = success => success({coords: {latitude: 21.030, longitude: 105.836}});}")
        self.primary = self.backup = "hold"
        start = time.perf_counter()
        self.find()
        self.completed()
        elapsed = time.perf_counter() - start
        self.assertEqual(len(self.requests), 1)
        self.assertLess(elapsed, 2)
        print(f"\nPersistent-cache nearby search: {elapsed * 1000:.0f} ms; additional Overpass requests: 0", flush=True)

    def upload_prescription(self):
        self.page.locator('[data-tab="prescription"]').click()
        image = self.page.evaluate("""() => {
            const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 300;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,200,300);
            return canvas.toDataURL().split(',')[1];
        }""")
        self.page.locator("#prescriptionFile").set_input_files({
            "name": "prescription.png", "mimeType": "image/png",
            "buffer": base64.b64decode(image),
        })

    def seed_inventory(self):
        self.page.evaluate("""() => {
            const medicines = [{name:'Paracetamol 500mg', quantity:10}, {name:'Vitamin C 500mg', quantity:10}];
            const store = (name, latitude, stock) => ({pharmacy:{name, address:'Hà Nội', latitude, longitude:105.834}, medicines:stock});
            localStorage.setItem('smartPharmacyOwnerData', JSON.stringify({
                full:store('Nhà thuốc đủ thuốc',21.029,medicines),
                partial:store('Nhà thuốc thiếu thuốc',21.029,medicines.slice(0,1)),
                zero:store('Nhà thuốc hết hàng',21.029,[medicines[0],{...medicines[1],quantity:0}]),
                wrong:store('Nhà thuốc sai hàm lượng',21.029,[{name:'Paracetamol 250mg',quantity:10},medicines[1]]),
                far:store('Nhà thuốc xa',21.065,medicines),
            }));
        }""")

    def test_prescription_requires_review_and_matches_all_medicines_in_stock(self):
        self.seed_inventory()
        self.upload_prescription()
        expect(self.page.locator("#prescriptionMedicines li")).to_have_text(["Paracetamol 500mg", "Vitamin C 500mg"])
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        self.assertEqual(self.page.evaluate("window.locationRequests"), 0)
        self.page.locator("#confirmPrescriptionMedicines").check()
        self.page.locator("#prescriptionButton").click()
        self.completed(1)
        expect(self.page.locator("#pharmacyList h3")).to_have_text("Nhà thuốc đủ thuốc")
        expect(self.page.locator(".stock-match")).to_contain_text("Paracetamol 500mg, Vitamin C 500mg")
        self.assertEqual(self.requests, [])  # An OSM proximity query cannot verify medicine availability.
        self.page.locator("#searchRadius").select_option("5000")
        self.completed(2)
        self.page.locator("#medicineInput").fill("Loratadine 10mg")
        expect(self.page.locator("#confirmPrescriptionMedicines")).not_to_be_checked()
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        expect(self.page.locator("#results")).to_be_hidden()

    def test_unreadable_or_failed_ocr_never_enables_search_from_image_alone(self):
        self.ocr_text = "ĐƠN THUỐC\nHọ tên: Nguyễn Văn A"
        self.upload_prescription()
        expect(self.page.locator("#prescriptionOcrStatus")).to_have_attribute("data-state", "error")
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        expect(self.page.locator("#prescriptionMedicines li")).to_have_count(0)
        self.page.evaluate("window.failPrescriptionOcr = true")
        self.page.locator("#retryPrescriptionOcr").click()
        expect(self.page.locator("#prescriptionOcrStatus")).to_contain_text("Không đọc được ảnh")
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        # Manual entry still works after OCR failure; unknown inventory is not presented as matching stock.
        self.page.locator("#medicineInput").fill("Paracetamol 500mg")
        self.page.locator("#confirmPrescriptionMedicines").check()
        self.page.locator("#prescriptionButton").click()
        self.completed(0)
        expect(self.page.locator("#status")).to_contain_text("chưa khai báo tồn kho")

    def test_uncertain_ocr_rows_are_marked_for_review_and_cleaned_before_search(self):
        self.ocr_confidence = 58
        self.ocr_text = "1. Baciamin Plus (NT) 1 tỉ CFU (Saccharomyces boulardii)\n2. PROHEPATIS (NT) 200mg (Desmodium)"
        self.upload_prescription()
        expect(self.page.locator("#prescriptionMedicines .needs-review")).to_have_count(2)
        expect(self.page.locator("#medicineInput")).to_have_value("Baciamin Plus 1tỉCFU\nPROHEPATIS 200mg")
        expect(self.page.locator("#prescriptionOcrStatus")).to_contain_text("2 dòng chưa chắc chắn")
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        self.page.locator("#medicineInput").fill("Baciamin Plus 1tỉCFU\nPROHEPATIS 100mg")
        expect(self.page.locator("#prescriptionMedicines .needs-review")).to_have_count(1)

    def test_complementary_ocr_readings_retain_rows_missing_from_a_confident_first_pass(self):
        self.ocr_readings = [
            {'text':'1. Paracetamol 500mg\n2. Loratadine 10mg','confidence':96},
            {'text':'2. Loratadine 10mg\n3. Vitamin C 500mg','confidence':95},
            {'text':'1. Paracetamol 500mg\n3. Vitamin C 500mg\n4. Metformin 500mg','confidence':94},
        ]
        self.upload_prescription()
        expect(self.page.locator('#medicineInput')).to_have_value('Paracetamol 500mg\nLoratadine 10mg\nVitamin C 500mg\nMetformin 500mg')
        expect(self.page.locator('#prescriptionMedicines li')).to_have_count(4)
        expect(self.page.locator('#prescriptionMedicines .needs-review')).to_have_count(1)
        expect(self.page.locator('#prescriptionButton')).to_be_disabled()

    def test_full_ocr_text_and_original_image_are_available_for_review_and_cleared_on_removal(self):
        self.ocr_text = 'ĐƠN THUỐC\nHọ tên: Bệnh nhân kiểm thử\n1. Paracetamol 500mg\n3. Loratadine 10mg'
        self.upload_prescription()
        expect(self.page.locator('#prescriptionOcrStatus')).to_contain_text('Số thứ tự chưa liên tục')
        expect(self.page.locator('#openPrescriptionImage')).to_have_attribute('href',re.compile(r'^blob:'))
        self.page.locator('#prescriptionRawDetails summary').click()
        raw=self.page.locator('#prescriptionRawText').input_value()
        self.assertIn('Họ tên: Bệnh nhân kiểm thử',raw)
        self.assertIn('Lần đọc 3',raw)
        self.page.locator('#removePrescriptionImage').click()
        expect(self.page.locator('#prescriptionRawDetails')).to_be_hidden()
        expect(self.page.locator('#prescriptionRawText')).to_have_value('')
        expect(self.page.locator('#openPrescriptionImage')).to_be_hidden()

    def test_ocr_filters_document_noise_before_display_and_stock_search(self):
        self.seed_inventory()
        self.ocr_confidence = 58
        self.ocr_text = '''1. LL SỞ Y TẾ TP.HỒ CHÍ MINH SỐ hồ sơ: 70180.140717744 955
2. PON THUOC
1. Paracetamol 500mg
2. Vitamin C 500mg
78 Đường Giải Phóng, Phương Mai, Đống Đa, Hà Nội
3. Thứ 7
4. Chủ nhật (từ 7h30 đến 16h30)
5. Hotline: 0901234567
6. n¤'''
        self.upload_prescription()
        expect(self.page.locator('#medicineInput')).to_have_value('Paracetamol 500mg\nVitamin C 500mg')
        expect(self.page.locator('#prescriptionMedicines li')).to_have_text(['Paracetamol 500mg','Vitamin C 500mg'])
        expect(self.page.locator('#prescriptionMedicines .needs-review')).to_have_count(2)
        expect(self.page.locator('#prescriptionMedicines li').first).to_have_attribute('aria-label',re.compile('cần đối chiếu ảnh'))
        expect(self.page.locator('#prescriptionRawDetails')).not_to_have_attribute('open','')
        self.page.locator('#prescriptionRawDetails summary').click()
        self.assertIn('78 Đường Giải Phóng', self.page.locator('#prescriptionRawText').input_value())
        self.page.locator('#confirmPrescriptionMedicines').check()
        self.page.locator('#prescriptionButton').click()
        self.completed(1)
        expect(self.page.locator('#pharmacyList h3')).to_have_text('Nhà thuốc đủ thuốc')

    def test_document_only_image_does_not_offer_noise_as_medicines(self):
        self.ocr_text = '1. PON THUOC\n78 Đường Giải Phóng, Phương Mai, Đống Đa, Hà Nội\n2. Thứ 7\n3. Số hồ sơ: 70180140717744'
        self.upload_prescription()
        expect(self.page.locator('#prescriptionOcrStatus')).to_have_attribute('data-state','error')
        expect(self.page.locator('#prescriptionMedicines li')).to_have_count(0)
        expect(self.page.locator('#medicineInput')).to_have_value('')
        expect(self.page.locator('#prescriptionButton')).to_be_disabled()
        expect(self.page.locator('#prescriptionRawDetails')).to_be_visible()

    def test_printed_prescription_layouts_are_filtered_without_losing_kdnt_medicines(self):
        fixtures=json.loads((ROOT.parent/'tests/fixtures/printed-prescription-layouts.json').read_text())
        for fixture in fixtures:
            with self.subTest(layout=fixture['id']):
                self.ocr_text=fixture['text']
                self.page.reload(wait_until='networkidle')
                self.upload_prescription()
                expect(self.page.locator('#medicineInput')).to_have_value('\n'.join(fixture['expected']))
                expect(self.page.locator('#prescriptionMedicines li')).to_have_count(len(fixture['expected']))
                expect(self.page.locator('#prescriptionButton')).to_be_disabled()

    def test_medicine_region_is_read_again_to_recover_rows_missing_from_whole_page(self):
        fixture=json.loads((ROOT.parent/'tests/fixtures/printed-prescription-layouts.json').read_text())[1]
        line=lambda text,y: {'text':text,'confidence':94,'bbox':{'x0':20,'y0':y,'x1':500,'y1':y+20}}
        partial={'lines':[line('Chỉ định dùng thuốc:',100),line('1. Althax [KDNT] 120mg',150),
            line('5. Cefimed 400mg',500),line('Lời dặn của bác sĩ:',700)]}
        self.ocr_readings=[partial,partial,partial,{'text':fixture['text'],'confidence':94},{'text':fixture['text'],'confidence':95}]
        self.upload_prescription()
        expect(self.page.locator('#medicineInput')).to_have_value('\n'.join(fixture['expected']))
        self.assertEqual(self.page.evaluate('window.prescriptionOcrPasses'),5)
        options=self.page.evaluate('window.prescriptionOcrOptions')
        self.assertIsNone(options[0].get('rectangle'))
        self.assertGreater(options[3]['rectangle']['top'],0)
        self.assertLess(options[3]['rectangle']['height'],900)
        expect(self.page.locator('#prescriptionButton')).to_be_disabled()

    def test_remove_image_during_ocr_discards_late_results_and_allows_same_file(self):
        self.page.evaluate("""() => {
            window.holdPrescriptionOcr = true;
            const revoke = URL.revokeObjectURL.bind(URL);
            URL.revokeObjectURL = url => { window.revokedPrescriptionImage = url; revoke(url); };
        }""")
        self.upload_prescription()
        self.page.wait_for_function("typeof window.finishPrescriptionOcr === 'function'")
        self.page.locator("#removePrescriptionImage").click()
        self.page.evaluate("window.finishPrescriptionOcr()")
        expect(self.page.locator("#preview")).to_be_hidden()
        expect(self.page.locator("#prescriptionFile")).to_have_value("")
        expect(self.page.locator("#medicineInput")).to_have_value("")
        expect(self.page.locator("#prescriptionMedicines li")).to_have_count(0)
        expect(self.page.locator('#prescriptionRawDetails')).to_be_hidden()
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()
        self.assertTrue(self.page.evaluate("window.revokedPrescriptionImage.startsWith('blob:')"))
        self.page.evaluate("window.holdPrescriptionOcr = false")
        self.upload_prescription()
        expect(self.page.locator("#prescriptionMedicines li")).to_have_count(2)
        self.page.locator("#confirmPrescriptionMedicines").check()
        self.page.locator("#removePrescriptionImage").click()
        expect(self.page.locator("#confirmPrescriptionMedicines")).not_to_be_checked()
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()

    def test_prescription_search_fetches_all_api_pages_and_checks_strength(self):
        def store(name, strength):
            return {"name": name, "address": "Hà Nội", "lat": 21.029, "lng": 105.834, "distance_m": 110,
                    "items": [{"available": [{"name": "Paracetamol", "strength": strength, "quantity": 5},
                                              {"name": "Vitamin C", "strength": "500mg", "quantity": 5}]}]}
        self.api_stock = [store("Sai hàm lượng", "250mg"), store("Đủ thuốc từ API", "500mg")]
        self.page.reload(wait_until="networkidle")
        self.upload_prescription()
        expect(self.page.locator("#prescriptionMedicines li")).to_have_count(2)
        self.page.locator("#confirmPrescriptionMedicines").check()
        self.page.locator("#prescriptionButton").click()
        self.completed(1)
        expect(self.page.locator("#pharmacyList h3")).to_have_text("Đủ thuốc từ API")
        self.assertEqual([body["page"] for body in self.stock_requests], [1, 2])
        self.assertEqual(self.stock_requests[0]["medicine_names"], ["Paracetamol", "Vitamin C"])
        self.assertTrue(self.stock_requests[0]["require_all"])
        self.assertEqual(self.stock_requests[0]["radius_km"], 3)

    def name_search_payload(self):
        self.payload = {"elements": [
            {"type": "node", "id": i, "lat": 21.028 + i * 0.0005, "lon": 105.834,
             "tags": {"amenity": "pharmacy", "name": "FPT Long Châu"}} for i in range(1, 8)
        ] + [
            {"type": "node", "id": 20, "lat": 21.065, "lon": 105.834,
             "tags": {"amenity": "pharmacy", "name": "Nhà thuốc Long Châu xa"}},
            {"type": "node", "id": 21, "lat": 21.029, "lon": 105.834,
             "tags": {"amenity": "pharmacy", "name": "Nhà thuốc không cùng tên"}},
        ]}

    def test_name_search_returns_every_matching_branch_and_repeats_with_radius(self):
        self.name_search_payload()
        self.page.locator("#pharmacySearch").fill("long chau")
        self.page.locator("#pharmacySearch").press("Enter")
        self.completed(7)  # Full results are not subject to the five-item autocomplete limit.
        expect(self.page.locator("#map .leaflet-marker-icon")).to_have_count(7)
        expect(self.page.locator("#status")).to_contain_text("long chau")
        self.page.locator("#searchRadius").select_option("5000")
        self.completed(8)
        expect(self.page.locator("#pharmacyList")).not_to_contain_text("không cùng tên")
        self.assertEqual(self.page.evaluate("window.locationRequests"), 1)

    def test_selecting_name_suggestion_searches_branches_in_selected_address(self):
        self.name_search_payload()
        self.page.locator("#addressInput").fill("Hà Nội")
        self.page.locator("#addressSearchButton").click()
        self.completed(8)
        self.page.locator("#pharmacySearch").fill("Long Châu")
        self.page.locator(".pharmacy-suggestion").first.click()
        self.completed(7)
        expect(self.page.locator("#pharmacyList h3").first).to_have_text("FPT Long Châu")
        self.assertEqual(self.page.evaluate("window.locationRequests"), 0)
        self.assertEqual(self.geocode_requests, 1)

    def test_unknown_name_shows_empty_results_without_falling_back_to_nearby(self):
        self.page.locator("#pharmacySearch").fill("Tên nhà thuốc không tồn tại")
        self.page.locator("#pharmacySearchButton").click()
        self.completed(0)
        expect(self.page.locator('#pharmacyList [data-state="empty"]')).to_be_visible()
        expect(self.page.locator("#status")).to_contain_text("Tên nhà thuốc không tồn tại")

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_reads_an_actual_image_before_review(self):
        self.real_ocr = True
        self.page.locator('[data-tab="prescription"]').click()
        image = self.page.evaluate("""() => {
            const canvas = document.createElement('canvas'); canvas.width=1200; canvas.height=500;
            const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,500);
            ctx.fillStyle='black';ctx.font='36px Arial';
            ['DON THUOC','1. Paracetamol 500mg','2. Loratadine 10mg','3. Vitamin C 500mg']
                .forEach((line,i)=>ctx.fillText(line,45,70+i*90));
            return canvas.toDataURL().split(',')[1];
        }""")
        self.page.locator("#prescriptionFile").set_input_files({
            "name": "real-prescription.png", "mimeType": "image/png", "buffer": base64.b64decode(image)})
        expect(self.page.locator("#prescriptionMedicines li")).to_have_text([
            "Paracetamol 500mg", "Loratadine 10mg", "Vitamin C 500mg"], timeout=90000)
        expect(self.page.locator("#prescriptionButton")).to_be_disabled()

    def printed_ocr_sample(self, labels, difficult=False, document_noise=False):
        self.real_ocr = True
        self.page.locator('[data-tab="prescription"]').click()
        image = self.page.evaluate("""({labels,difficult,document_noise}) => {
            const paper=document.createElement('canvas');paper.width=1400;paper.height=2000;
            const ctx=paper.getContext('2d');
            const shadow=ctx.createLinearGradient(0,0,1400,0);
            shadow.addColorStop(0,difficult?'#a9a9a9':'white');shadow.addColorStop(1,difficult?'#eeeeee':'white');
            ctx.fillStyle=shadow;ctx.fillRect(0,0,1400,2000);
            ctx.fillStyle=difficult?'#555555':'#111111';ctx.font='bold 34px Arial';
            ctx.fillText('ĐƠN THUỐC',540,90);ctx.font='24px Arial';
            ctx.fillText('Họ tên: Bệnh nhân kiểm thử',70,145);ctx.fillText('Chẩn đoán: Kiểm thử đọc ảnh',70,190);
            labels.forEach((label,index)=>{
                const y=280+index*135;ctx.font='28px Arial';ctx.fillText((index+1)+'. '+label,75,y);
                ctx.font='22px Arial';ctx.fillText('Uống theo hướng dẫn của bác sĩ',105,y+38);
                ctx.fillText('SL: 20 viên',1120,y);
            });
            if(document_noise){
                ctx.font='24px Arial';ctx.fillText('SỞ Y TẾ HÀ NỘI - SỐ HỒ SƠ: 70180140717744',75,235);
                ['78 Đường Giải Phóng, Phương Mai, Đống Đa, Hà Nội',
                 'Thứ 2 đến thứ 6', 'Thứ 7', 'Chủ nhật (từ 7h30 đến 16h30)',
                 'Hotline: 0901234567'].forEach((line,index)=>ctx.fillText(line,75,1450+index*55));
            }
            ctx.font='23px Arial';ctx.fillText('Ngày 15 tháng 11 năm 2026',850,1820);
            ctx.fillText('Bác sĩ kê đơn',1000,1880);
            if(!difficult)return paper.toDataURL('image/png').split(',')[1];
            const photo=document.createElement('canvas');photo.width=1520;photo.height=2100;
            const photoCtx=photo.getContext('2d');photoCtx.fillStyle='#777777';photoCtx.fillRect(0,0,1520,2100);
            photoCtx.translate(90,20);photoCtx.rotate(2.3*Math.PI/180);photoCtx.filter='blur(0.65px)';photoCtx.drawImage(paper,0,0);
            return photo.toDataURL('image/jpeg',0.70).split(',')[1];
        }""", {'labels':labels,'difficult':difficult,'document_noise':document_noise})
        self.page.locator('#prescriptionFile').set_input_files({'name':'printed-shadow.jpg' if difficult else 'printed-list.png',
            'mimeType':'image/jpeg' if difficult else 'image/png','buffer':base64.b64decode(image)})
        self.page.wait_for_function("document.querySelector('#prescriptionOcrStatus').dataset.state !== 'reading'",timeout=90000)
        actual=self.page.locator('#medicineInput').input_value()
        self.assertEqual(self.page.locator('#prescriptionMedicines li').count(),len(labels),actual)
        self.assertEqual([re.sub(r'\s+',' ',line).lower() for line in actual.splitlines()],[label.lower() for label in labels],actual)
        expect(self.page.locator('#prescriptionButton')).to_be_disabled()
        self.assertEqual(self.page.evaluate('window.locationRequests'),0)

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_keeps_all_ten_rows_of_a_clear_printed_prescription(self):
        self.printed_ocr_sample(['Paracetamol 500mg','Loratadine 10mg','Cetirizine 10mg','Metformin 500mg',
            'Omeprazole 20mg','Amlodipine 5mg','Losartan 50mg','Atorvastatin 10mg','Vitamin C 500mg','Vitamin D3 1000IU'])

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_keeps_lower_rows_with_tilt_blur_and_shadow(self):
        self.printed_ocr_sample(['Paracetamol 500mg','Loratadine 10mg','Cetirizine 10mg','Metformin 500mg',
            'Omeprazole 20mg','Amlodipine 5mg','Losartan 50mg','Vitamin C 500mg'],difficult=True)

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_filters_clinic_address_and_hours_from_a_printed_image(self):
        self.printed_ocr_sample(['Paracetamol 500mg','Loratadine 10mg','Cetirizine 10mg','Metformin 500mg',
            'Omeprazole 20mg','Vitamin C 500mg'],document_noise=True)

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_reads_recreated_numbered_and_kdnt_printed_layouts(self):
        # Generated raster fixtures from anonymized transcriptions; these are not the user's original photos.
        fixtures=json.loads((ROOT.parent/'tests/fixtures/printed-prescription-layouts.json').read_text())
        for fixture in fixtures:
            with self.subTest(layout=fixture['id']):
                self.real_ocr=True
                self.page.reload(wait_until='networkidle')
                self.page.locator('[data-tab="prescription"]').click()
                image=self.page.evaluate(r"""text => {
                    const paper=document.createElement('canvas');paper.width=1000;paper.height=1200;
                    const ctx=paper.getContext('2d');
                    const shadow=ctx.createLinearGradient(0,0,1000,0);
                    shadow.addColorStop(0,'#cccccc');shadow.addColorStop(1,'#fafafa');
                    ctx.fillStyle=shadow;ctx.fillRect(0,0,1000,1200);ctx.fillStyle='#111111';
                    let y=40;
                    for(const line of text.split('\n')){
                        const numbered=/^\d\s*[./]/.test(line);
                        ctx.font=numbered?'bold 20px Times New Roman':'17px Times New Roman';
                        let row='';
                        for(const word of line.split(' ')){
                            if(ctx.measureText(row+' '+word).width>790){ctx.fillText(row,50,y);y+=25;row='';}
                            row+=(row?' ':'')+word;
                        }
                        ctx.fillText(row,50,y);
                        if(numbered){ctx.font='18px Times New Roman';ctx.fillText('X 30 Viên',850,y);}
                        y+=28;
                    }
                    const photo=document.createElement('canvas');photo.width=740;photo.height=900;
                    const output=photo.getContext('2d');output.fillStyle='#999999';output.fillRect(0,0,740,900);
                    output.translate(22,8);output.rotate(1.1*Math.PI/180);output.drawImage(paper,0,0,700,840);
                    return photo.toDataURL('image/jpeg',0.82).split(',')[1];
                }""",fixture['text'])
                self.page.locator('#prescriptionFile').set_input_files({'name':fixture['id']+'.jpg','mimeType':'image/jpeg','buffer':base64.b64decode(image)})
                self.page.wait_for_function("document.querySelector('#prescriptionOcrStatus').dataset.state !== 'reading'",timeout=90000)
                actual=self.page.locator('#medicineInput').input_value()
                raw=self.page.locator('#prescriptionRawText').input_value()
                self.assertEqual(len(actual.splitlines()),len(fixture['expected']),actual+'\n\n'+raw)
                self.assertEqual([line.lower() for line in actual.splitlines()],[line.lower() for line in fixture['expected']],actual)
                self.assertIn('Lần đọc 5',self.page.locator('#prescriptionRawText').input_value())
                expect(self.page.locator('#prescriptionButton')).to_be_disabled()

    @unittest.skipUnless(os.environ.get("PRESCRIPTION_OCR_ASSET_DIR"), "Set PRESCRIPTION_OCR_ASSET_DIR to verified CDN engine/language assets")
    def test_real_ocr_recovers_tilted_low_contrast_rows_and_flags_ambiguous_name(self):
        self.real_ocr = True
        self.page.locator('[data-tab="prescription"]').click()
        image = self.page.evaluate("""() => {
            const canvas = document.createElement('canvas'); canvas.width=760; canvas.height=900;
            const ctx=canvas.getContext('2d');
            const shadow=ctx.createLinearGradient(0,0,760,0);shadow.addColorStop(0,'#a0a0a0');shadow.addColorStop(1,'#e0e0e0');
            ctx.fillStyle=shadow;ctx.fillRect(0,0,760,900);
            ctx.translate(25,0);ctx.rotate(1.5*Math.PI/180);ctx.fillStyle='#585858';ctx.font='bold 20px Times New Roman';
            ctx.fillText('ĐƠN THUỐC',280,70);ctx.font='15px Times New Roman';
            ctx.fillText('Họ tên: Bệnh nhân kiểm thử',30,110);ctx.fillText('Chẩn đoán: Kiểm thử nhận diện',30,140);
            ['1. Baciamin Plus (NT) 1 tỉ CFU (Saccharomyces boulardii)',
             '2. Esapbe (NT) 40mg (Esomeprazole)',
             '3. Alipro (NT) (THỰC PHẨM CHỨC NĂNG)',
             '4. PROHEPATIS (NT) 200mg (Desmodium)'].forEach((text,i)=>{
                const y=220+i*90;ctx.font='bold 15px Times New Roman';ctx.fillText(text,30,y);
                ctx.font='13px Times New Roman';ctx.fillText('Uống sáng 1 viên, tối 1 viên',45,y+25);
                ctx.fillText('x 30 ngày = 60 Viên',540,y);
             });
            ctx.fillText('Ngày 12 tháng 11 năm 2026',420,660);ctx.fillText('Bác sĩ khám bệnh',450,700);
            return canvas.toDataURL('image/jpeg',0.65).split(',')[1];
        }""")
        self.page.locator("#prescriptionFile").set_input_files({
            "name": "tilted-prescription.jpg", "mimeType": "image/jpeg", "buffer": base64.b64decode(image)})
        self.page.wait_for_function("document.querySelector('#prescriptionOcrStatus').dataset.state !== 'reading'", timeout=90000)
        actual = self.page.locator("#medicineInput").input_value()
        self.assertEqual(self.page.locator("#prescriptionMedicines li").count(), 4, actual)
        first = actual.splitlines()[0]
        self.assertRegex(first.lower(), r"^baciamin \w+ 1t[ỉiỷy]cfu$")
        # Small serif print can still confuse l/i. A guessed name must not be presented as certain.
        if "baciamin plus" not in first.lower():
            expect(self.page.locator("#prescriptionMedicines li").first).to_have_class("needs-review")
            expect(self.page.locator("#prescriptionOcrStatus")).to_contain_text("chưa chắc chắn")
        self.assertIn("Esapbe 40mg", actual)
        self.assertIn("Alipro", actual)
        self.assertIn("PROHEPATIS 200mg", actual)
        self.assertNotIn("(NT)", actual)
        self.assertNotIn("Saccharomyces", actual)


if __name__ == "__main__":
    unittest.main(verbosity=2)
