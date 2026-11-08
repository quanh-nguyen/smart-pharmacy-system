const { pool } = require('../../config/db');
const {
  ApiError,
  optionalCoords,
  boundingBoxWkt,
  pageMeta,
  currentTimeVN,
  openNowSql,
  decoratePharmacy,
} = require('../../utils/helpers');

// approvedOnly = true: chi chap nhan nha thuoc da duoc xac thuc (dung cho API xem kho cong khai)
async function assertPharmacy(id, { approvedOnly = false } = {}) {
  const approvedSql = approvedOnly ? " AND verification_status = 'approved'" : '';
  const [rows] = await pool.query(`SELECT id FROM pharmacies WHERE id = ? AND is_active = 1${approvedSql}`, [id]);
  if (!rows.length) throw new ApiError(404, 'Khong tim thay nha thuoc');
}

async function assertMedicine(id) {
  const [rows] = await pool.query('SELECT id FROM medicines WHERE id = ? AND is_active = 1', [id]);
  if (!rows.length) throw new ApiError(404, 'Khong tim thay thuoc');
}

// Gioi han theo kieu cot: price DECIMAL(12,0), quantity INT
const MAX_PRICE = 999999999999;
const MAX_QUANTITY = 2147483647;

// So nguyen khong am: chap nhan so hoac chuoi so, tu choi null, '', mang, true, so le, so qua lon
function parseWhole(value, field, max) {
  const ok = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = ok ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new ApiError(400, `${field} phai la so nguyen tu 0 den ${max}`);
  }
  return n;
}

// Danh sach hang cua mot nha thuoc
async function listByPharmacy(pharmacyId, { inStock, page, limit, offset }) {
  await assertPharmacy(pharmacyId, { approvedOnly: true });
  const where = ['i.pharmacy_id = ?', 'm.is_active = 1'];
  const params = [pharmacyId];
  if (inStock) where.push('i.quantity > 0');
  const whereSql = where.join(' AND ');

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inventory i JOIN medicines m ON m.id = i.medicine_id WHERE ${whereSql}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT m.id AS medicine_id, m.name, m.strength, m.unit, m.is_prescription, i.price, i.quantity,
            (i.quantity > 0) AS in_stock, i.updated_at
     FROM inventory i JOIN medicines m ON m.id = i.medicine_id
     WHERE ${whereSql} ORDER BY m.name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return {
    data: rows.map((r) => ({ ...r, in_stock: !!r.in_stock })),
    pagination: pageMeta(page, limit, total),
  };
}

// Them moi hoac cap nhat gia/ton kho cua 1 thuoc tai 1 nha thuoc
async function upsert(pharmacyId, medicineId, { price, quantity }) {
  await assertPharmacy(pharmacyId);
  await assertMedicine(medicineId);
  const p = parseWhole(price, 'price', MAX_PRICE);
  const q = parseWhole(quantity, 'quantity', MAX_QUANTITY);

  await pool.query(
    `INSERT INTO inventory (pharmacy_id, medicine_id, price, quantity) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE price = VALUES(price), quantity = VALUES(quantity)`,
    [pharmacyId, medicineId, p, q]
  );
  return { pharmacy_id: pharmacyId, medicine_id: medicineId, price: p, quantity: q };
}

async function remove(pharmacyId, medicineId) {
  const [result] = await pool.query('DELETE FROM inventory WHERE pharmacy_id = ? AND medicine_id = ?', [
    pharmacyId,
    medicineId,
  ]);
  if (!result.affectedRows) throw new ApiError(404, 'Nha thuoc khong co thuoc nay trong kho');
}

// Nhung nha thuoc (da xac thuc) dang ban 1 thuoc; co GPS thi kem khoang cach va sap theo gan nhat
async function availability(medicineId, { lat, lng, radiusKm, openNow, at }) {
  await assertMedicine(medicineId);
  const now = currentTimeVN(at);
  const c = optionalCoords(lat, lng);
  const openSql = openNow ? ` AND ${openNowSql(now)}` : '';
  const fields = `p.id AS pharmacy_id, p.name, p.address, p.district, p.phone, p.opening_time, p.closing_time,
            ST_Y(p.location) AS lat, ST_X(p.location) AS lng, i.price, i.quantity`;
  const baseWhere = `i.medicine_id = ? AND i.quantity > 0 AND p.is_active = 1 AND p.verification_status = 'approved'`;

  if (!c) {
    const [rows] = await pool.query(
      `SELECT ${fields}
       FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
       WHERE ${baseWhere}${openSql}
       ORDER BY i.price ASC`,
      [medicineId]
    );
    return rows.map((r) => decoratePharmacy(r, now));
  }

  const bbox = boundingBoxWkt(c.lat, c.lng, radiusKm);
  const [rows] = await pool.query(
    `SELECT ${fields}, ST_Distance_Sphere(p.location, POINT(?, ?)) AS distance_m
     FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
     WHERE ${baseWhere} AND MBRContains(ST_GeomFromText(?), p.location)${openSql}
     HAVING distance_m <= ?
     ORDER BY distance_m ASC`,
    [c.lng, c.lat, medicineId, bbox, radiusKm * 1000]
  );
  return rows.map((r) => ({ ...decoratePharmacy(r, now), distance_m: Math.round(r.distance_m) }));
}

module.exports = { listByPharmacy, upsert, remove, availability };
