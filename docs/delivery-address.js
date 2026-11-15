// User-triggered address lookup. Keep results in memory only; never treat a city
// or a nearby street returned by a fuzzy search as a verified delivery address.
const cache = new Map();
let nextRequestAt = 0;

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

function expandAddress(value) {
  return String(value || '').normalize('NFC')
    .replace(/(^|[\s,;])ng\.\s*/giu, '$1ngõ ')
    .replace(/(^|[\s,;])ngh\.\s*/giu, '$1ngách ')
    .replace(/(^|[\s,;])[đd]\.\s*/giu, '$1đường ')
    .replace(/(^|[\s,;])p\.\s*/giu, '$1phường ')
    .replace(/(^|[\s,;])q\.\s*/giu, '$1quận ')
    .replace(/(^|[\s,;])tp\.\s*/giu, '$1thành phố ')
    .replace(/\s+/g, ' ').trim();
}

function addressParts(query) {
  const parts = expandAddress(query).split(',').map(part => part.trim()).filter(Boolean);
  const first = parts[0] || '';
  const number = first.match(/^(?:số\s+)?(\d+[a-z]?(?:\s*[/-]\s*\d+[a-z]?)*)(?=\s|,|$)/iu)?.[1];
  let street = number ? first.slice(first.indexOf(number) + number.length).trim() : '';
  const separateStreet = Boolean(number && !street && parts[1]);
  if (separateStreet) street = parts[1];
  const namedStreet = street.match(/(?:^|\s)(?:đường|phố)\s+(.+)$/iu);
  if (namedStreet) street = namedStreet[1].trim();
  else street = street.replace(/^(?:(?:ngõ|ngách|hẻm|kiệt)\s+\d+[a-z]?(?:[/-]\d+[a-z]?)*\s*)+/iu, '').trim();
  const places = parts.slice(separateStreet ? 2 : 1).filter(part => !['viet nam', 'vietnam', 'vn'].includes(normalize(part)));
  return { number, street, region: places.at(-1) || '' };
}

function placeName(value) {
  return normalize(expandAddress(value)).replace(/\bhn\b/g, 'ha noi').replace(/\b(?:hcm|tphcm)\b/g, 'ho chi minh')
    .replace(/^(?:(?:duong|pho|thanh pho|tinh|tp)\s+)+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
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
  const requestedNumber = normalize(query).match(/(?:^|,)\s*(?:so\s+)?(\d+[a-z]?(?:[/-]\d+[a-z]?)*)\b/)?.[1];
  if (!requestedNumber || requestedNumber !== normalize(number).replace(/\s/g, '')) return null;
  const expectedStreet = placeName(addressParts(query).street);
  const display = ` ${normalize(item.display_name).replace(/[^a-z0-9]+/g, ' ')} `;
  if (expectedStreet && expectedStreet !== placeName(road) && !display.includes(` ${expectedStreet} `)) return null;
  const terms = words(query), found = new Set(words(`${item.display_name} ${number} ${road}`));
  if (terms.length < 3 || !terms.every(term => found.has(term))) return null;
  return { label: String(item.display_name), latitude, longitude, houseNumber: number, road: String(road), precision: 'address', houseNumberVerified: true,
    osmId: String(item.osm_id || item.place_id || ''), osmType: String(item.osm_type || '') };
}

function matchStreet(item, parts, requestedAddress) {
  const address = item.address || {};
  const road = address.road || address.pedestrian || address.residential || address.footway
    || (['road', 'street', 'pedestrian', 'residential', 'footway'].includes(item.addresstype) ? item.name : '');
  const latitude = Number(item.lat), longitude = Number(item.lon);
  const regions = [address.city, address.town, address.municipality, address.province, address.state].filter(Boolean);
  if (address.country_code !== 'vn' || !road || placeName(road) !== placeName(parts.street)
    || !regions.some(region => placeName(region) === placeName(parts.region))
    || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // This is a street/area match. Its point must never be presented as the customer's house.
  const region = regions.find(region => placeName(region) === placeName(parts.region));
  return { label: `${road}, ${region}`, requestedAddress, latitude, longitude,
    houseNumber: parts.number, road: String(road), precision: 'street', houseNumberVerified: false,
    osmId: String(item.osm_id || item.place_id || ''), osmType: String(item.osm_type || '') };
}

async function addressSearch(query, signal) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', countrycodes: 'vn', limit: '5', 'accept-language': 'vi' });
  const data = await requestAddress(url, signal);
  if (!Array.isArray(data)) throw new Error('Dịch vụ kiểm tra địa chỉ trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
  return data.filter(item => item && typeof item === 'object');
}

async function requestAddress(url, signal) {
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
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), credentials: 'omit' });
    if (!response.ok) throw new Error('Address service unavailable');
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Chưa kết nối được dịch vụ kiểm tra địa chỉ. Vui lòng thử lại hoặc chọn nhận tại nhà thuốc.');
  }
}

export async function searchDeliveryAddresses(query, { signal } = {}) {
  query = query.trim();
  const expanded = expandAddress(query);
  if (query.length < 8 || words(expanded).length < 3) {
    throw new Error('Vui lòng nhập số nhà, tên đường và tỉnh/thành phố để kiểm tra địa chỉ.');
  }
  const key = query;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 5 * 60 * 1000) return saved.items;
  const data = await addressSearch(expanded, signal);
  const unique = new Map();
  for (const item of data) {
    const match = matchAddress(item, expanded);
    if (match) unique.set(`${match.latitude},${match.longitude},${match.label}`, match);
  }
  let items = [...unique.values()];
  if (!items.length) {
    const parts = addressParts(expanded);
    if (parts.number && parts.street && !parts.region) {
      throw new Error('Vui lòng bổ sung tỉnh/thành phố sau tên đường để đối chiếu địa chỉ nhập thủ công.');
    }
    if (parts.number && parts.street && parts.region) {
      const streets = await addressSearch(`${parts.street}, ${parts.region}`, signal);
      for (const item of streets) {
        const match = matchStreet(item, parts, query);
        if (match) unique.set(match.label, match);
      }
      items = [...unique.values()];
    }
  }
  if (cache.size >= 30) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), items });
  return items;
}

export async function addressAtCurrentPosition(latitude, longitude, { signal } = {}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Không lấy được tọa độ hợp lệ. Bạn có thể nhập địa chỉ thủ công.');
  }
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: 'jsonv2', addressdetails: '1', zoom: '18', 'accept-language': 'vi' });
  const item = await requestAddress(url, signal);
  if (!item || typeof item.display_name !== 'string' || !item.display_name.trim() || item.display_name.length > 500 || item.address?.country_code !== 'vn') {
    throw new Error('Chưa tìm được địa chỉ tại vị trí hiện tại ở Việt Nam. Vui lòng nhập địa chỉ thủ công.');
  }
  return { label: item.display_name, complete: Boolean(item.address.house_number && (item.address.road || item.address.pedestrian || item.address.residential || item.address.footway)) };
}
