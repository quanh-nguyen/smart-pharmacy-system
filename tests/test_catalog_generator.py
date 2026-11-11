import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/update_pharmacy_catalog.py"
spec = importlib.util.spec_from_file_location("catalog_generator", SCRIPT)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
BOUNDS = [20, 105, 22, 107]
DATA = {"elements": [
    {"type": "node", "id": 1, "lat": 21.028, "lon": 105.834, "tags": {"amenity": "pharmacy", "name": "Nhà thuốc kiểm thử"}},
    {"type": "way", "id": 2, "center": {"lat": 21.03, "lon": 105.84}, "tags": {"healthcare": "pharmacy"}},
]}


class CatalogGeneratorTests(unittest.TestCase):
    def test_normalizes_coordinates_and_deduplicates_osm_ids(self):
        records = catalog.normalize_response({"elements": DATA["elements"] + DATA["elements"]}, BOUNDS)
        self.assertEqual(len(records), 2)
        self.assertEqual(records[1]["lat"], 21.03)
        self.assertNotIn("center", records[1])

    def test_rejects_partial_or_coordinate_free_data(self):
        for data in [{**DATA, "remark": "Query timed out"}, {"elements": []}, {"elements": [{"type": "node", "id": 1}]}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                catalog.normalize_response(data, BOUNDS)

    def test_failed_download_preserves_all_previous_files(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            catalog.atomic_json(output / "index.json", {"previous": True})
            catalog.atomic_json(output / "first.json", {"old": True})
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            calls = 0
            def loader(bounds, minimum):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise ValueError("Incomplete response")
                return catalog.normalize_response(DATA, bounds, minimum)
            with self.assertRaises(ValueError):
                catalog.refresh([{"id": "first", "bounds": BOUNDS}, {"id": "second", "bounds": BOUNDS}], output, loader)
            self.assertEqual(before, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_cli_import_writes_matching_complete_manifest_and_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "regions.json").write_text(json.dumps([{"id": "test", "bounds": BOUNDS}]))
            (root / "export.json").write_text(json.dumps(DATA))
            result = subprocess.run([sys.executable, str(SCRIPT), "--regions", str(root / "regions.json"),
                "--input", str(root / "export.json"), "--output", str(root / "output")], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((root / "output/index.json").read_text())
            dataset = json.loads((root / "output/test.json").read_text())
            self.assertTrue(dataset["complete"])
            self.assertEqual(dataset["generatedAt"], manifest["datasets"][0]["generatedAt"])
            self.assertEqual(len(dataset["elements"]), 2)
            self.assertIn("OpenStreetMap", dataset["attribution"])


if __name__ == "__main__":
    unittest.main()
