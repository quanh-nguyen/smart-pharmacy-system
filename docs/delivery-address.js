// User-triggered address lookup. Keep results in memory only; never treat a city
// or a nearby street returned by a fuzzy search as a verified delivery address.
const cache = new Map();
let nextRequestAt = 0;

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

function words(value) {
  const labels = new Set(['so', 'duong', 'pho', 'phuong', 'xa', 'quan', 'huyen', 'tinh', 'thanh', 'tp', 'p', 'q', 'viet', 'nam', 'vn']);
  return (normalize(value).replace(/\b(?:hn)\b/g, 'ha noi').replace(/\b(?:tphcm|hcm)\b/g, 'ho chi minh').match(/[a-z0-9]+/g) || []).filter(word => !labels.has(word));
}

function matchAddress(item, query) {
  const address = item.address || {};
  const latitude = Number(item.lat), longitude = Number(item.lon);
  const road = address.road || address.pedestrian || address.residential || address.footway;
  const number = String(address.house_number || '').trim();
  const locality = address.city || address.town || address.village || address.municipality || address.county || address.state;
  if (address.country_code !== 'vn' || !road || !number || !locality || !item.display_name || String(item.display_name).length > 500
    || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const requestedNumber = normalize(query).match(/^(?:so\s+)?(\d+[a-z]?(?:[/-]\d+[a-z]?)*)\b/)?.[1];
  if (requestedNumber && requestedNumber !== normalize(number).replace(/\s/g, '')) return null;
  const terms = words(query), found = new Set(words(`${item.display_name} ${number} ${road}`));
  if (terms.length < 3 || !terms.every(term => found.has(term))) return null;
  return { label: String(item.display_name), latitude, longitude, houseNumber: number, road: String(road),
    osmId: String(item.osm_id || item.place_id || ''), osmType: String(item.osm_type || '') };
}

export async function searchDeliveryAddresses(query, { signal } = {}) {
  query = query.trim();
  if (query.length < 8 || words(query).length < 3) {
    throw new Error('Vui lòng nhập số nhà, tên đường và tỉnh/thành phố để kiểm tra địa chỉ.');
  }
  const key = normalize(query);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 5 * 60 * 1000) return saved.items;
  // The public Nominatim service allows at most one request per second.
  const start = Math.max(Date.now(), nextRequestAt);
  nextRequestAt = start + 1100;
  await new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, start - Date.now());
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
  signal?.throwIfAborted();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'vn', limit: '5', 'accept-language': 'vi' });
  let response;
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), credentials: 'omit' });
    if (!response.ok) throw new Error('Address service unavailable');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Invalid address response');
    const unique = new Map();
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const match = matchAddress(item, query);
      if (match) unique.set(`${match.latitude},${match.longitude},${match.label}`, match);
    }
    const items = [...unique.values()];
    if (cache.size >= 30) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), items });
    return items;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Chưa kết nối được dịch vụ kiểm tra địa chỉ. Vui lòng thử lại hoặc chọn nhận tại nhà thuốc.');
  }
}
