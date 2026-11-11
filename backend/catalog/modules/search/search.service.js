const { pool } = require('../../config/db');
const {
  ApiError,
  removeAccents,
  parseBool,
  parseCoords,
  optionalCoords,
  parseFlag,
  boundingBoxWkt,
  pageMeta,
  parsePagination,
  currentTimeVN,
  openNowSql,
  decoratePharmacy,
} = require('../../utils/helpers');

const MAX_ITEMS = 30; // so thuoc toi da moi lan tim
const MAX_MEDICINES_PER_NAME = 20; // 1 ten thuoc co the khop nhieu san pham

const toArray = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// Chi cho phep cac cach sap xep nam trong danh sach nay (tranh SQL injection qua ORDER BY)
const FIXED_SORTS = {
  distance: 'distance_m ASC, p.id ASC', // gan nhat
  price: 'total_price ASC, distance_m ASC', // tong gia thap nhat
  supply: 'matched_count DESC, total_quantity DESC, distance_m ASC', // kha nang cung ung
};
FIXED_SORTS.matched = FIXED_SORTS.supply; // ten cu, giu de tuong thich

// Goi y nhanh khi go ten thuoc (autocomplete): ten thuong mai hoac hoat chat
async function suggestMedicines(q, limit = 8) {
  const kw = removeAccents(q);
  if (!kw) return [];
  const [rows] = await pool.query(
    `SELECT id, name, active_ingredient, strength, is_prescription FROM medicines
     WHERE is_active = 1 AND (name_search LIKE ? OR ingredient_search LIKE ?)
     ORDER BY (name_search LIKE ?) DESC, name ASC LIMIT ?`,
    [`%${kw}%`, `%${kw}%`, `${kw}%`, limit]
  );
  return rows;
}

// O tim kiem chung: tra ve ca thuoc va nha thuoc khop tu khoa (ten, dia chi, khu vuc)
async function quickSearch(q, { lat, lng, limit = 5 }) {
  const text = removeAccents(q || '');
  if (!text) throw new ApiError(400, 'Thieu tu khoa q');
  const now = currentTimeVN();
  const medicines = await suggestMedicines(q, limit);
  const fields = `p.id, p.name, p.address, p.district, p.phone, p.opening_time, p.closing_time,
            ST_Y(p.location) AS lat, ST_X(p.location) AS lng`;
  const where = `p.is_active = 1 AND p.verification_status = 'approved' AND p.search_text LIKE ?`;

  const c = optionalCoords(lat, lng);
  if (c) {
    const [rows] = await pool.query(
      `SELECT ${fields}, ST_Distance_Sphere(p.location, POINT(?, ?)) AS distance_m
       FROM pharmacies p WHERE ${where} ORDER BY distance_m ASC LIMIT ?`,
      [c.lng, c.lat, `%${text}%`, limit]
    );
    return {
      medicines,
      pharmacies: rows.map((r) => ({ ...decoratePharmacy(r, now), distance_m: Math.round(r.distance_m) })),
    };
  }
  const [rows] = await pool.query(
    `SELECT ${fields} FROM pharmacies p WHERE ${where} ORDER BY p.name ASC LIMIT ?`,
    [`%${text}%`, limit]
  );
  return { medicines, pharmacies: rows.map((r) => decoratePharmacy(r, now)) };
}

// Doi danh sach thuoc nguoi dung nhap (id va/hoac ten) thanh cac "muc can mua".
// Moi muc gom 1 hoac nhieu san pham: nhap ten "paracetamol" thi nha thuoc co BAT KY san pham nao khop la du.
async function resolveItems(body) {
  // moi id phai la so nguyen duong (so hoac chuoi so); true/null/''/[] khong duoc doi ngam thanh so
  const ids = [
    ...new Set(
      toArray(body.medicine_ids).map((raw) => {
        const ok = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '');
        const n = ok ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n < 1) throw new ApiError(400, 'medicine_ids phai la mang id thuoc hop le');
        return n;
      })
    ),
  ];
  const names = [];
  const seen = new Set();
  for (const raw of toArray(body.medicine_names)) {
    if (typeof raw !== 'string') throw new ApiError(400, 'medicine_names phai la mang chuoi');
    const name = raw.trim();
    const key = removeAccents(name);
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  if (!ids.length && !names.length) throw new ApiError(400, 'Can medicine_ids hoac medicine_names');
  if (ids.length + names.length > MAX_ITEMS) throw new ApiError(400, `Toi da ${MAX_ITEMS} thuoc moi lan tim`);

  const items = [];
  if (ids.length) {
    const [rows] = await pool.query(
      'SELECT id, name, strength, ingredient_search FROM medicines WHERE id IN (?) AND is_active = 1',
      [ids]
    );
    const found = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!found.has(id)) throw new ApiError(404, `Khong tim thay thuoc id ${id}`);
      items.push({ type: 'id', value: id, medicines: [found.get(id)] });
    }
  }
  for (const name of names) {
    const kw = removeAccents(name);
    const [rows] = await pool.query(
      `SELECT id, name, strength, ingredient_search FROM medicines
       WHERE is_active = 1 AND (name_search LIKE ? OR ingredient_search LIKE ?)
       ORDER BY (name_search LIKE ?) DESC, name ASC LIMIT ?`,
      [`%${kw}%`, `%${kw}%`, `${kw}%`, MAX_MEDICINES_PER_NAME]
    );
    if (!rows.length) throw new ApiError(404, `Khong tim thay thuoc "${name}"`);
    items.push({ type: 'name', value: name, medicines: rows });
  }
  return items;
}

// Thuoc thay the (cung hoat chat) dang co o it nhat 1 nha thuoc da xac thuc
async function alternativesForItems(items) {
  const result = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const it = items[idx];
    const baseIds = it.medicines.map((m) => m.id);
    const ingredients = [...new Set(it.medicines.map((m) => m.ingredient_search).filter(Boolean))];
    if (!ingredients.length) continue;

    const [rows] = await pool.query(
      `SELECT m.id, m.name, m.strength, m.active_ingredient, m.is_prescription
       FROM medicines m
       WHERE m.is_active = 1 AND m.ingredient_search IN (?) AND m.id NOT IN (?)
         AND EXISTS (SELECT 1 FROM inventory i JOIN pharmacies p ON p.id = i.pharmacy_id
                     WHERE i.medicine_id = m.id AND i.quantity > 0
                       AND p.is_active = 1 AND p.verification_status = 'approved')
       ORDER BY m.name ASC LIMIT 10`,
      [ingredients, baseIds]
    );
    const baseStrengths = new Set(it.medicines.map((m) => (m.strength || '').toLowerCase()).filter(Boolean));
    const meds = rows
      .map((r) => ({ ...r, same_strength: !!r.strength && baseStrengths.has(r.strength.toLowerCase()) }))
      .sort((a, b) => Number(b.same_strength) - Number(a.same_strength));
    if (meds.length) result.push({ requested_index: idx, requested: it.value, medicines: meds });
  }
  return result;
}

/**
 * Tim nha thuoc gan nhat dang co san hang cho danh sach thuoc.
 * body: { medicine_ids:[..], medicine_names:[..], lat, lng, radius_km, require_all,
 *         open_now, at, district, sort, page, limit }
 */
async function searchPharmacies(body) {
  const items = await resolveItems(body);
  const { lat, lng } = parseCoords(body.lat, body.lng);
  const radiusKm = Math.min(Math.max(Number(body.radius_km) || 5, 0.1), 50);
  // mac dinh: phai du tat ca thuoc; chi nhan true/false (hoac 1/0, 'true'/'false'), gia tri la bao 400
  const requireAll = body.require_all === undefined ? true : parseFlag(body.require_all, 'require_all') === 1;
  const openNow = parseBool(body.open_now);
  const now = currentTimeVN(body.at);
  const { page, limit, offset } = parsePagination(body); // cung quy tac phan trang voi cac API danh sach
  const sortSql =
    body.sort === 'open'
      ? `${openNowSql(now)} DESC, distance_m ASC` // dang mo cua truoc, roi gan nhat
      : FIXED_SORTS[body.sort] || FIXED_SORTS.distance;

  // Bang tam "req": moi dong = (muc can mua, id san pham). Chi chua so nguyen lay tu CSDL nen nhung thang vao SQL la an toan.
  const reqSql = items
    .flatMap((it, idx) => it.medicines.map((m) => `SELECT ${idx} AS item, ${Number(m.id)} AS mid`))
    .join(' UNION ALL ');

  const bbox = boundingBoxWkt(lat, lng, radiusKm);
  const extraWhere = [];
  const extraParams = [];
  if (body.district) {
    extraWhere.push('p.search_text LIKE ?');
    extraParams.push(`%${removeAccents(body.district)}%`);
  }
  if (openNow) extraWhere.push(openNowSql(now));
  const extraSql = extraWhere.length ? ` AND ${extraWhere.join(' AND ')}` : '';

  // Thu tu tham so khop thu tu dau ? trong cau SQL: POINT(lng,lat), bbox, district, ban kinh, so muc
  const params = [lng, lat, bbox, ...extraParams, radiusKm * 1000];
  if (requireAll) params.push(items.length);

  const inner = `
    SELECT p.id, p.name, p.address, p.district, p.phone, p.opening_time, p.closing_time,
           ST_Y(p.location) AS lat, ST_X(p.location) AS lng,
           ST_Distance_Sphere(p.location, POINT(?, ?)) AS distance_m,
           COUNT(*) AS matched_count,
           SUM(t.best_price) AS total_price,
           SUM(t.max_qty) AS total_quantity
    FROM pharmacies p
    JOIN (
      SELECT i.pharmacy_id, req.item, MIN(i.price) AS best_price, MAX(i.quantity) AS max_qty
      FROM (${reqSql}) req
      JOIN inventory i ON i.medicine_id = req.mid AND i.quantity > 0
      GROUP BY i.pharmacy_id, req.item
    ) t ON t.pharmacy_id = p.id
    WHERE p.is_active = 1 AND p.verification_status = 'approved'
      AND MBRContains(ST_GeomFromText(?), p.location)${extraSql}
    GROUP BY p.id
    HAVING distance_m <= ?${requireAll ? ' AND matched_count = ?' : ''}`;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${inner}) x`, params);
  const [rows] = await pool.query(`${inner} ORDER BY ${sortSql} LIMIT ? OFFSET ?`, [...params, limit, offset]);

  // Chi tiet tung thuoc (gia, ton) cua cac nha thuoc trong trang nay
  const byPharmacy = {};
  if (rows.length) {
    const allIds = [...new Set(items.flatMap((it) => it.medicines.map((m) => m.id)))];
    const [inv] = await pool.query(
      `SELECT i.pharmacy_id, m.id AS medicine_id, m.name, m.strength, m.unit, m.is_prescription, i.price, i.quantity
       FROM inventory i JOIN medicines m ON m.id = i.medicine_id
       WHERE i.pharmacy_id IN (?) AND i.medicine_id IN (?) AND i.quantity > 0`,
      [rows.map((r) => r.id), allIds]
    );
    for (const r of inv) (byPharmacy[r.pharmacy_id] ||= []).push(r);
  }

  const data = rows.map((r) => {
    const matched = Number(r.matched_count);
    const stock = byPharmacy[r.id] || [];
    return {
      ...decoratePharmacy(r, now),
      distance_m: Math.round(r.distance_m),
      matched_count: matched,
      total_price: Number(r.total_price),
      total_quantity: Number(r.total_quantity),
      has_all: matched === items.length,
      missing_count: items.length - matched,
      items: items.map((it, idx) => {
        const ids = new Set(it.medicines.map((m) => m.id));
        const available = stock
          .filter((s) => ids.has(s.medicine_id))
          .sort((a, b) => a.price - b.price)
          .map(({ pharmacy_id, ...rest }) => rest);
        return { requested_index: idx, requested: it.value, available };
      }),
    };
  });

  const out = {
    requested: items.map((it, index) => ({
      index,
      type: it.type,
      value: it.value,
      medicines: it.medicines.map((m) => ({ id: m.id, name: m.name })),
    })),
    data,
    pagination: pageMeta(page, limit, total),
  };
  // Khong nha thuoc nao co hang: goi y thuoc thay the theo hoat chat / ham luong
  if (total === 0) out.alternatives = await alternativesForItems(items);
  return out;
}

module.exports = { suggestMedicines, quickSearch, searchPharmacies };
