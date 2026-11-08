const { pool } = require('../../config/db');
const { ApiError, removeAccents, pageMeta, parseFlag } = require('../../utils/helpers');

const SORTS = {
  name: 'm.name ASC',
  newest: 'm.id DESC',
};

const LIST_FIELDS = `m.id, m.name, m.active_ingredient, m.strength, m.category, m.dosage_form,
            m.unit, m.manufacturer, m.is_prescription`;

// Tra cuu thuoc theo ten thuong mai hoac hoat chat (tim khong dau)
async function list({ q, category, ingredient, strength, prescription, sort, page, limit, offset }) {
  const where = ['m.is_active = 1'];
  const params = [];

  if (q) {
    const kw = `%${removeAccents(q)}%`;
    where.push('(m.name_search LIKE ? OR m.ingredient_search LIKE ?)');
    params.push(kw, kw);
  }
  if (category) {
    where.push('m.category = ?');
    params.push(category);
  }
  if (ingredient) {
    where.push('m.ingredient_search LIKE ?');
    params.push(`%${removeAccents(ingredient)}%`);
  }
  if (strength) {
    where.push('LOWER(m.strength) = ?');
    params.push(String(strength).trim().toLowerCase());
  }
  if (prescription === '0' || prescription === '1') {
    where.push('m.is_prescription = ?');
    params.push(Number(prescription));
  }
  const whereSql = where.join(' AND ');
  const orderSql = SORTS[sort] || SORTS.name;

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM medicines m WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT ${LIST_FIELDS} FROM medicines m WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return { data: rows, pagination: pageMeta(page, limit, total) };
}

async function getById(id) {
  const [rows] = await pool.query('SELECT * FROM medicines WHERE id = ? AND is_active = 1', [id]);
  if (!rows.length) throw new ApiError(404, 'Khong tim thay thuoc');
  return rows[0];
}

// Goi y thuoc thay the: cung hoat chat, uu tien cung ham luong
async function alternatives(id, { sameStrengthOnly, limit }) {
  const med = await getById(id);
  const base = { id: med.id, name: med.name, active_ingredient: med.active_ingredient, strength: med.strength };
  if (!med.ingredient_search) return { medicine: base, data: [] };

  const params = [med.strength, id, med.ingredient_search];
  let strengthSql = '';
  if (sameStrengthOnly) {
    strengthSql = ' AND m.strength <=> ?';
    params.push(med.strength);
  }
  params.push(limit);

  const [rows] = await pool.query(
    `SELECT ${LIST_FIELDS}, (m.strength <=> ?) AS same_strength
     FROM medicines m
     WHERE m.is_active = 1 AND m.id <> ? AND m.ingredient_search = ?${strengthSql}
     ORDER BY same_strength DESC, m.name ASC LIMIT ?`,
    params
  );
  return { medicine: base, data: rows.map((r) => ({ ...r, same_strength: !!r.same_strength })) };
}

async function categories() {
  const [rows] = await pool.query(
    `SELECT category, COUNT(*) AS total FROM medicines
     WHERE is_active = 1 AND category IS NOT NULL
     GROUP BY category ORDER BY category`
  );
  return rows;
}

// Ten thuoc: bat buoc la chuoi khong rong sau khi cat khoang trang thua
function cleanName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'Ten thuoc khong duoc de trong');
  return value.trim();
}

async function create(body) {
  const name = cleanName(body.name);
  const [result] = await pool.query(
    `INSERT INTO medicines
       (name, name_search, active_ingredient, ingredient_search, strength, category, dosage_form, unit,
        manufacturer, description, is_prescription)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      removeAccents(name),
      body.active_ingredient || null,
      body.active_ingredient ? removeAccents(body.active_ingredient) : null,
      body.strength || null,
      body.category || null,
      body.dosage_form || null,
      body.unit || null,
      body.manufacturer || null,
      body.description || null,
      body.is_prescription === undefined ? 0 : parseFlag(body.is_prescription, 'is_prescription'),
    ]
  );
  return getById(result.insertId);
}

async function update(id, body) {
  await getById(id);
  const fields = [];
  const params = [];
  if (body.name !== undefined) body = { ...body, name: cleanName(body.name) };
  for (const key of ['name', 'active_ingredient', 'strength', 'category', 'dosage_form', 'unit', 'manufacturer', 'description']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(body[key]);
    }
  }
  if (body.name !== undefined) {
    fields.push('name_search = ?');
    params.push(removeAccents(body.name));
  }
  if (body.active_ingredient !== undefined) {
    fields.push('ingredient_search = ?');
    params.push(body.active_ingredient ? removeAccents(body.active_ingredient) : null);
  }
  if (body.is_prescription !== undefined) {
    fields.push('is_prescription = ?');
    params.push(parseFlag(body.is_prescription, 'is_prescription'));
  }
  if (!fields.length) throw new ApiError(400, 'Khong co du lieu de cap nhat');

  await pool.query(`UPDATE medicines SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  return getById(id);
}

async function remove(id) {
  await getById(id);
  await pool.query('UPDATE medicines SET is_active = 0 WHERE id = ?', [id]);
}

module.exports = { list, getById, alternatives, categories, create, update, remove };
