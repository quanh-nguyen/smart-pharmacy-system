class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'];

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Bo dau tieng Viet + chu thuong, dung de tim khong dau
function removeAccents(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bo dau ket hop
    .replace(/\u0111/g, 'd') // chu d gach ngang (thuong)
    .replace(/\u0110/g, 'D') // chu D gach ngang (hoa)
    .toLowerCase()
    .trim();
}

function toInt(value, name, { min = null } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || (min !== null && n < min)) {
    throw new ApiError(400, `${name} khong hop le`);
  }
  return n;
}

function toNum(value, name) {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || Number.isNaN(n)) {
    throw new ApiError(400, `${name} khong hop le`);
  }
  return n;
}

function parseBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

// Co 0/1 nghiem ngat cho du lieu ghi: chi nhan true/false, 1/0, '1'/'0', 'true'/'false'.
// Khong dung truthy cua JS (chuoi 'false' se bi coi la dung).
function parseFlag(value, field) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  throw new ApiError(400, `${field} chi nhan true/false hoac 1/0`);
}

// Toa do tuy chon: khong gui ca hai -> null (khong dung GPS); chi gui mot trong hai -> 400; du ca hai -> kiem tra hop le
function optionalCoords(lat, lng) {
  if (lat === undefined && lng === undefined) return null;
  if (lat === undefined || lng === undefined) throw new ApiError(400, 'Phai gui du ca lat va lng');
  return parseCoords(lat, lng);
}

function parseCoords(lat, lng) {
  const la = toNum(lat, 'lat');
  const lo = toNum(lng, 'lng');
  if (la < -90 || la > 90 || lo < -180 || lo > 180) {
    throw new ApiError(400, 'Toa do nam ngoai pham vi hop le');
  }
  return { lat: la, lng: lo };
}

// Hop bao quanh (bounding box) de dung SPATIAL INDEX truoc khi tinh khoang cach chinh xac
function boundingBoxWkt(lat, lng, radiusKm) {
  const dLat = radiusKm / 111.32;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const dLng = radiusKm / (111.32 * cos);
  const minX = lng - dLng;
  const maxX = lng + dLng;
  const minY = lat - dLat;
  const maxY = lat + dLat;
  return `POLYGON((${minX} ${minY},${maxX} ${minY},${maxX} ${maxY},${minX} ${maxY},${minX} ${minY}))`;
}

// So nguyen tu query/body: khong gui hoac rong -> undefined; gui thi phai la so nguyen that su, nguoc lai 400
// (khong am tham chuyen '2abc' thanh 2 hay '3.5' thanh 3).
function strictInt(value, name) {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) return Number(value.trim());
  throw new ApiError(400, `${name} phai la so nguyen`);
}

// page/limit phai la so nguyen (sai dinh dang -> 400); so nguyen nam ngoai khoang thi duoc ep vao khoang cho phep
function parsePagination(query, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const rawPage = strictInt(query.page, 'page');
  const rawLimit = strictInt(query.limit, 'limit');
  const page = Math.max(rawPage === undefined ? 1 : rawPage, 1);
  const limit = Math.min(Math.max(rawLimit === undefined ? defaultLimit : rawLimit, 1), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

// Gioi han so dong cho cac API goi y / o tim chung: so nguyen thi ep vao [1, max], con lai dung gia tri mac dinh.
// Tranh dua so am hoac so le vao LIMIT cua SQL.
function parseLimit(value, defaultLimit, maxLimit) {
  const usable = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = usable ? Number(value) : NaN;
  if (!Number.isInteger(n)) return defaultLimit;
  return Math.min(Math.max(n, 1), maxLimit);
}

function pageMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

// ---------- Gio mo cua ----------

// Nhan "HH:MM" hoac "HH:MM:SS", tra ve "HH:MM:SS"; rong thi tra ve null
function parseTimeOrNull(value, name = 'gio') {
  if (value === undefined || value === null || value === '') return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(value).trim());
  if (!m) throw new ApiError(400, `${name} phai co dang HH:MM`);
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

// Gio hien tai theo mui gio Viet Nam (hoac gio `at` do client gui de test)
function currentTimeVN(at) {
  const custom = parseTimeOrNull(at, 'at');
  if (custom) return custom;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
}

// Dieu kien SQL "dang mo cua". `now` da duoc kiem tra dang HH:MM:SS nen nhung thang vao SQL la an toan.
// Khoang mo cua la [mo, dong): dung gio dong cua (vd 22:00:00) la da dong.
// NULL gio = mo ca ngay; opening = closing = mo ca ngay; closing < opening = mo qua nua dem.
function openNowSql(now, alias = 'p') {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(now)) throw new Error('now khong hop le');
  const o = `${alias}.opening_time`;
  const c = `${alias}.closing_time`;
  return (
    `(${o} IS NULL OR ${c} IS NULL OR ${o} = ${c}` +
    ` OR (${o} < ${c} AND '${now}' >= ${o} AND '${now}' < ${c})` +
    ` OR (${o} > ${c} AND ('${now}' >= ${o} OR '${now}' < ${c})))`
  );
}

// Ban JS cua openNowSql, dung de gan co is_open cho tung nha thuoc
function isOpenNow(opening, closing, now) {
  if (!opening || !closing || opening === closing) return true;
  if (opening < closing) return now >= opening && now < closing;
  return now >= opening || now < closing;
}

// Duong dan chi duong (mo Google Maps tu vi tri hien tai den nha thuoc)
function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function decoratePharmacy(row, now) {
  return {
    ...row,
    is_open: isOpenNow(row.opening_time, row.closing_time, now),
    directions_url: directionsUrl(row.lat, row.lng),
  };
}

module.exports = {
  ApiError,
  VERIFICATION_STATUSES,
  asyncHandler,
  removeAccents,
  toInt,
  toNum,
  parseBool,
  parseFlag,
  parseCoords,
  optionalCoords,
  boundingBoxWkt,
  parsePagination,
  parseLimit,
  pageMeta,
  parseTimeOrNull,
  currentTimeVN,
  openNowSql,
  isOpenNow,
  directionsUrl,
  decoratePharmacy,
};
