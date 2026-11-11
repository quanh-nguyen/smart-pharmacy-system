"""Browser regression tests; only external search responses and map tiles are simulated.

See README.md for Playwright and Leaflet test setup.
"""
import os
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
        if url.startswith(self.base + "/data/pharmacies/index.json") and self.serve_real_catalog:
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
        elif "router.project-osrm.org" in url:
            route.fulfill(json={"routes": [{"distance": 1200, "duration": 300, "geometry": {
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
        expect(self.page.locator("#status")).to_contain_text("1.20 km")

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
