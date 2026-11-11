const { pool } = require('../../config/db');
const {
  ApiError,
  VERIFICATION_STATUSES,
  removeAccents,
  toInt,
  parseCoords,
  boundingBoxWkt,
  pageMeta,
  parseTimeOrNull,
  currentTimeVN,
  openNowSql,
  decoratePharmacy,
} = require('../../utils/helpers');

const SELECT_FIELDS = `
  p.id, p.name, p.address, p.district, p.phone, p.opening_time, p.closing_time,
  p.verification_status, p.is_active,
  ST_Y(p.location) AS lat, ST_X(p.location) AS lng`;

// Danh sach nha thuoc.
// - Cong khai (admin = false): LUON chi tra nha thuoc da duoc xac thuc (approved), bo qua `status`.
// - Quan tri (admin = true, route /api/admin/pharmacies): loc theo status = pending | approved | rejected | all.
async function list({ q, district, status, admin = false, openNow, at, sort, page, limit, offset }) {
  let st = 'approved';
  if (admin) {
    st = status || 'pending';
    if (st !== 'all' && !VERIFICATION_STATUSES.includes(st)) {
      throw new ApiError(400, 'status phai la pending, approved, rejected hoac all');
    }
  }
  const now = currentTimeVN(at);
  const where = ['p.is_active = 1'];
  const params = [];

  if (st !== 'all') {
    where.push('p.verification_status = ?');
    params.push(st);
  }
  if (q) {
    // tim khong dau tren ten + dia chi + khu vuc
    where.push('p.search_text LIKE ?');
    params.push(`%${removeAccents(q)}%`);
  }
  if (district) {
    where.push('p.search_text LIKE ?');
    params.push(`%${removeAccents(district)}%`);
  }
  if (openNow) where.push(openNowSql(now));

  const whereSql = where.join(' AND ');
  const orderSql = sort === 'open' ? `${openNowSql(now)} DESC, p.name ASC` : 'p.name ASC';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM pharmacies p WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT ${SELECT_FIELDS} FROM pharmacies p WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { data: rows.map((r) => decoratePharmacy(r, now)), pagination: pageMeta(page, limit, total) };
}

// publicOnly = true: chi tra nha thuoc dang hoat dong va da duoc xac thuc (dung cho API cong khai).
// Noi bo / quan tri goi khong co publicOnly de thay moi nha thuoc.
async function getById(id, { publicOnly = false, includeOwner = false } = {}) {
  const publicSql = publicOnly ? ` AND p.is_active = 1 AND p.verification_status = 'approved'` : '';
  const ownerFields = includeOwner ? ', p.created_at, owner.name AS owner_name, owner.email AS owner_email' : '';
  const ownerJoin = includeOwner ? ' LEFT JOIN business_user_profiles owner ON owner.id = p.owner_id' : '';
  const [rows] = await pool.query(`SELECT ${SELECT_FIELDS}${ownerFields} FROM pharmacies p${ownerJoin} WHERE p.id = ?${publicSql}`, [id]);
  if (!rows.length) throw new ApiError(404, 'Khong tim thay nha thuoc');
  return decoratePharmacy(rows[0], currentTimeVN());
}

// Nha thuoc da xac thuc gan vi tri GPS (khong xet hang ton). Tim theo thuoc: dung module search.
async function nearby({ lat, lng, radiusKm, q, district, openNow, at, sort, page, limit, offset }) {
  const coords = parseCoords(lat, lng);
  const now = currentTimeVN(at);
  const bbox = boundingBoxWkt(coords.lat, coords.lng, radiusKm);
  const radiusM = radiusKm * 1000;

  const extra = [];
  const extraParams = [];
  if (q) {
    extra.push('p.search_text LIKE ?');
    extraParams.push(`%${removeAccents(q)}%`);
  }
  if (district) {
    extra.push('p.search_text LIKE ?');
    extraParams.push(`%${removeAccents(district)}%`);
  }
  if (openNow) extra.push(openNowSql(now));
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';

  // Thu tu tham so khop thu tu dau ? trong cau SQL
  const baseParams = [coords.lng, coords.lat, bbox, coords.lng, coords.lat, radiusM, ...extraParams];

  const inner = `
    SELECT ${SELECT_FIELDS},
           ST_Distance_Sphere(p.location, POINT(?, ?)) AS distance_m
    FROM pharmacies p
    WHERE p.is_active = 1 AND p.verification_status = 'approved'
      AND MBRContains(ST_GeomFromText(?), p.location)
      AND ST_Distance_Sphere(p.location, POINT(?, ?)) <= ?${extraSql}`;

  const orderSql = sort === 'open' ? `${openNowSql(now)} DESC, distance_m ASC` : 'distance_m ASC';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${inner}) x`, baseParams);
  const [rows] = await pool.query(`${inner} ORDER BY ${orderSql} LIMIT ? OFFSET ?`, [
    ...baseParams,
    limit,
    offset,
  ]);
  return {
    data: rows.map((r) => ({ ...decoratePharmacy(r, now), distance_m: Math.round(r.distance_m) })),
    pagination: pageMeta(page, limit, total),
  };
}

// Nha thuoc dang ky moi luon o trang thai "pending" cho den khi admin xac thuc.
// Trang thai va chu so huu do SERVER quyet dinh, khong lay tu body: client gui verification_status / owner_id deu bi bo qua.
// ownerId chi duoc truyen tu noi bo (sau nay lay tu tai khoan dang nhap).
// Chuoi bat buoc: phai la chuoi, khong rong sau khi cat khoang trang thua
function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, `${field} khong duoc de trong`);
  return value.trim();
}

// Chuoi tuy chon: khong gui / null / rong -> null; co gia tri thi phai la chuoi, duoc cat khoang trang thua
function optionalText(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ApiError(400, `${field} phai la chuoi`);
  return value.trim() || null;
}

async function create(body, { ownerId = null } = {}) {
  const name = requiredText(body.name, 'name');
  const address = requiredText(body.address, 'address');
  const { lat, lng } = parseCoords(body.lat, body.lng);
  const district = optionalText(body.district, 'district');
  const opening = parseTimeOrNull(body.opening_time, 'opening_time');
  const closing = parseTimeOrNull(body.closing_time, 'closing_time');
  if ((opening === null) !== (closing === null)) {
    throw new ApiError(400, 'Phai gui ca opening_time va closing_time, hoac khong gui gi (mo ca ngay)');
  }
  const searchText = removeAccents(`${name} ${address} ${district || ''}`);

  const [result] = await pool.query(
    `INSERT INTO pharmacies (name, address, district, phone, opening_time, closing_time, location, search_text, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ST_GeomFromText(?), ?, ?)`,
    [name, address, district, optionalText(body.phone, 'phone'), opening, closing, `POINT(${lng} ${lat})`, searchText, ownerId]
  );
  return getById(result.insertId);
}

async function update(id, body) {
  const current = await getById(id);
  const fields = [];
  const params = [];

  // lam sach du lieu truoc: name / address bat buoc khong rong; district / phone co the xoa bang null hoac ''
  const clean = {};
  if (body.name !== undefined) clean.name = requiredText(body.name, 'name');
  if (body.address !== undefined) clean.address = requiredText(body.address, 'address');
  if (body.district !== undefined) clean.district = optionalText(body.district, 'district');
  if (body.phone !== undefined) clean.phone = optionalText(body.phone, 'phone');
  for (const key of Object.keys(clean)) {
    fields.push(`${key} = ?`);
    params.push(clean[key]);
  }
  if (body.opening_time !== undefined || body.closing_time !== undefined) {
    // gia tri sau khi sua = gia tri moi neu co gui, nguoc lai giu gia tri hien tai
    const opening = body.opening_time !== undefined ? parseTimeOrNull(body.opening_time, 'opening_time') : current.opening_time;
    const closing = body.closing_time !== undefined ? parseTimeOrNull(body.closing_time, 'closing_time') : current.closing_time;
    if ((opening === null) !== (closing === null)) {
      throw new ApiError(400, 'opening_time va closing_time phai cung co gia tri hoac cung la null (mo ca ngay)');
    }
    fields.push('opening_time = ?', 'closing_time = ?');
    params.push(opening, closing);
  }
  // owner_id KHONG duoc sua qua API; sau nay do module Auth quyet dinh
  if (body.lat !== undefined || body.lng !== undefined) {
    const { lat, lng } = parseCoords(body.lat, body.lng);
    fields.push('location = ST_GeomFromText(?)');
    params.push(`POINT(${lng} ${lat})`);
  }
  // doi ten / dia chi / khu vuc thi cap nhat lai cot tim khong dau
  if (['name', 'address', 'district'].some((k) => body[k] !== undefined)) {
    const name = clean.name !== undefined ? clean.name : current.name;
    const address = clean.address !== undefined ? clean.address : current.address;
    const district = clean.district !== undefined ? clean.district : current.district;
    fields.push('search_text = ?');
    params.push(removeAccents(`${name} ${address} ${district || ''}`));
  }
  if (!fields.length) throw new ApiError(400, 'Khong co du lieu de cap nhat');

  await pool.query(`UPDATE pharmacies SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  return getById(id);
}

// Admin xac thuc nha thuoc: pending -> approved / rejected
async function setVerification(id, status) {
  if (!VERIFICATION_STATUSES.includes(status)) {
    throw new ApiError(400, 'status phai la pending, approved hoac rejected');
  }
  await getById(id);
  await pool.query('UPDATE pharmacies SET verification_status = ? WHERE id = ?', [status, id]);
  return getById(id);
}

// Xoa mem de khong lam hong du lieu don hang sau nay
async function remove(id) {
  await getById(id);
  await pool.query('UPDATE pharmacies SET is_active = 0 WHERE id = ?', [id]);
}

module.exports = { list, getById, nearby, create, update, setVerification, remove };
