const MANIFEST_URL = new URL("./data/pharmacies/index.json", import.meta.url);
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let manifestPromise;
let manifestLoadedAt = 0;
const datasets = new Map();

export function getMapCoordinates(item) {
  const lat = item?.lat ?? item?.center?.lat;
  const lon = item?.lon ?? item?.center?.lon;
  if (lat == null || lon == null || lat === "" || lon === "") return null;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lon: longitude };
}

export function validBounds(bounds) {
  return Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite) &&
    bounds[0] >= -90 && bounds[2] <= 90 && bounds[0] < bounds[2] &&
    bounds[1] >= -180 && bounds[3] <= 180 && bounds[1] < bounds[3];
}

export function boundsContain(outer, inner) {
  return validBounds(outer) && validBounds(inner) && outer[0] <= inner[0] &&
    outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function getSearchBounds(latitude, longitude, radius) {
  const angularRadius = radius / 6371000;
  const paddingLat = angularRadius * 180 / Math.PI;
  const south = Math.max(-90, latitude - paddingLat);
  const north = Math.min(90, latitude + paddingLat);
  const paddingLon = south === -90 || north === 90 ? 180
    : Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(latitude * Math.PI / 180))) * 180 / Math.PI;
  const wrap = (value) => ((value + 540) % 360) - 180;
  return [south, paddingLon === 180 ? -180 : wrap(longitude - paddingLon),
    north, paddingLon === 180 ? 180 : wrap(longitude + paddingLon)];
}

async function fetchJson(url) {
  const controller = new AbortController();
  // Tệp danh mục có thể lớn hơn phản hồi tìm kiếm; nguồn live đã đua song song sau 1,5 giây.
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function loadManifest() {
  if (!manifestPromise || Date.now() - manifestLoadedAt >= MANIFEST_TTL_MS) {
    manifestLoadedAt = Date.now();
    manifestPromise = fetchJson(MANIFEST_URL).then((data) => {
      if (data.version !== 1 || !Array.isArray(data.datasets)) throw new Error("Invalid catalog manifest");
      return data.datasets.filter((entry) => validBounds(entry.bounds) &&
        /^[a-z0-9][a-z0-9._-]*\.json$/i.test(entry.file) &&
        Number.isFinite(Date.parse(entry.generatedAt)) &&
        Date.now() - Date.parse(entry.generatedAt) >= -300000 &&
        Date.now() - Date.parse(entry.generatedAt) <= CATALOG_MAX_AGE_MS);
    });
  }
  return manifestPromise;
}

function loadDataset(entry) {
  const key = `${entry.file}:${entry.generatedAt}`;
  if (!datasets.has(key)) {
    const url = new URL(entry.file, MANIFEST_URL);
    url.searchParams.set("v", entry.generatedAt);
    const promise = fetchJson(url).then((data) => {
      if (data.version !== 1 || data.complete !== true || data.generatedAt !== entry.generatedAt ||
          JSON.stringify(data.bounds) !== JSON.stringify(entry.bounds) ||
          !Array.isArray(data.elements) || !data.elements.every(getMapCoordinates)) {
        throw new Error("Invalid pharmacy catalog");
      }
      return data;
    }).catch((error) => {
      datasets.delete(key);
      throw error;
    });
    datasets.set(key, promise);
  }
  return datasets.get(key);
}

export async function findPharmacyCatalog(bounds) {
  const entries = await loadManifest();
  const entry = entries.find((candidate) => boundsContain(candidate.bounds, bounds));
  if (!entry) throw new Error("No catalog covers the requested area");
  const data = await loadDataset(entry);
  return {
    elements: data.elements.filter((item) => {
      const { lat, lon } = getMapCoordinates(item);
      return lat >= bounds[0] && lat <= bounds[2] && lon >= bounds[1] && lon <= bounds[3];
    }),
    catalogUpdatedAt: data.generatedAt
  };
}

// Tải dữ liệu công khai cùng trang, không cần gửi vị trí người dùng đến một dịch vụ tìm kiếm.
export function prefetchPharmacyCatalog() {
  loadManifest().then((entries) => Promise.allSettled(entries.map(loadDataset))).catch(() => {});
}
