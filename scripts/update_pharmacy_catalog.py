"""Create complete static OSM catalogs; failed/partial downloads never replace good data."""
import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import tempfile
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
ROOT = Path(__file__).resolve().parents[1]


def build_query(bounds):
    bbox = ",".join(str(value) for value in bounds)
    return f'''[out:json][timeout:120];
    (nwr["amenity"="pharmacy"]({bbox});
     nwr["healthcare"="pharmacy"]({bbox});
     nwr["shop"~"^(pharmacy|drugstore|chemist)$"]({bbox}););
    out center tags;'''


def normalize_response(data, bounds, minimum=1):
    if not isinstance(data, dict) or data.get("remark") or not isinstance(data.get("elements"), list):
        raise ValueError("Incomplete or invalid Overpass response")
    records = {}
    for item in data["elements"]:
        if not isinstance(item, dict):
            raise ValueError("Invalid OSM element")
        center = item.get("center") or {}
        lat, lon = item.get("lat", center.get("lat")), item.get("lon", center.get("lon"))
        if isinstance(lat, bool) or isinstance(lon, bool) or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            raise ValueError("OSM element is missing coordinates")
        if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
            raise ValueError("Invalid OSM coordinates")
        if not (bounds[0] <= lat <= bounds[2] and bounds[1] <= lon <= bounds[3]):
            continue
        if item.get("type") not in {"node", "way", "relation"} or not isinstance(item.get("id"), int):
            raise ValueError("OSM element is missing its identity")
        tags = item.get("tags") or {}
        if not isinstance(tags, dict) or any(not isinstance(value, str) for value in tags.values()):
            raise ValueError("Invalid OSM tags")
        records[(item["type"], item["id"])] = {
            "type": item["type"], "id": item["id"], "lat": lat, "lon": lon, "tags": tags
        }
    if len(records) < minimum:
        raise ValueError("Too few records; preserving the previous catalog")
    return list(records.values())


def download(bounds, minimum):
    errors = []
    for server in SERVERS:
        try:
            request = Request(server, data=urlencode({"data": build_query(bounds)}).encode(), headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "SmartPharmacyCatalog/1.0 (+https://github.com/Sn-Hwang/smart-pharmacy-system)",
            })
            # urllib respects the inherited HTTPS proxy and CA trust; verification stays enabled.
            with urlopen(request, timeout=180) as response:
                content = response.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError("Catalog exceeds the 20 MiB download limit")
            return normalize_response(json.loads(content), bounds, minimum)
        except (OSError, ValueError) as error:
            errors.append(f"{urlparse(server).hostname}: {type(error).__name__}")
    raise RuntimeError("All catalog sources failed: " + "; ".join(errors))


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(data, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        stream.write("\n")
    temporary.replace(path)


def refresh(regions, output, loader=download):
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    catalogs = []
    identifiers = set()
    for region in regions:
        identifier, bounds = region["id"], region["bounds"]
        if not isinstance(identifier, str) or not identifier or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for c in identifier):
            raise ValueError("Invalid region identifier")
        if identifier in identifiers:
            raise ValueError("Duplicate region identifier")
        identifiers.add(identifier)
        if not isinstance(bounds, list) or len(bounds) != 4 or not all(not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) for value in bounds) or not (
            -90 <= bounds[0] < bounds[2] <= 90 and -180 <= bounds[1] < bounds[3] <= 180
        ):
            raise ValueError("Invalid region bounds")
        minimum = region.get("min_count", 1)
        if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 1:
            raise ValueError("min_count must be a positive integer")
        elements = loader(bounds, minimum)
        catalogs.append((identifier, {
            "version": 1, "complete": True, "source": "OpenStreetMap", "generatedAt": generated,
            "bounds": bounds, "elements": elements,
            "attribution": "© OpenStreetMap contributors; ODbL 1.0",
            "licenseUrl": "https://www.openstreetmap.org/copyright",
        }))
    # All regions must succeed before replacing any published dataset or its manifest.
    entries = []
    for identifier, data in catalogs:
        filename = f"{identifier}.json"
        atomic_json(output / filename, data)
        entries.append({"id": identifier, "file": filename, "bounds": data["bounds"], "generatedAt": generated})
        print(f"{identifier}: {len(data['elements'])} OSM records")
    atomic_json(output / "index.json", {"version": 1, "datasets": entries})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", type=Path, default=ROOT / "scripts/catalog-regions.json")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/data/pharmacies")
    parser.add_argument("--input", type=Path, help="Import a complete Overpass JSON export instead of downloading")
    args = parser.parse_args()
    regions = json.loads(args.regions.read_text(encoding="utf-8"))
    if not isinstance(regions, list) or not regions or len(regions) > 20:
        raise ValueError("Expected 1–20 regions")
    loader = download
    if args.input:
        if len(regions) != 1:
            raise ValueError("--input requires exactly one region")
        exported = json.loads(args.input.read_text(encoding="utf-8"))
        loader = lambda bounds, minimum: normalize_response(exported, bounds, minimum)
    refresh(regions, args.output, loader)


if __name__ == "__main__":
    main()
