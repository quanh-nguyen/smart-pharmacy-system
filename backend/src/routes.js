const express = require('express');
const { authenticate, authorize } = require('./identity');
const User = require('../auth/src/models/User');
const { pool } = require('../catalog/src/config/db');

const router = express.Router();
router.get('/v1/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ success: true, data: { user: user.toPublicJSON() } });
});

router.get('/owner/workspace', authenticate, authorize('pharmacy'), async (req, res) => {
  const [stores] = await pool.query('SELECT id FROM pharmacies WHERE owner_id = ? AND is_active = 1', [req.user.id]);
  if (!stores.length) return res.json({ pharmacy: null, inventory: [] });
  const pharmacy = await require('../catalog/src/modules/pharmacies/pharmacies.service').getById(stores[0].id);
  const [inventory] = await pool.query(`SELECT m.id AS medicine_id, m.name, m.category, m.unit,
    m.strength, m.is_prescription, i.quantity, i.price FROM inventory i
    JOIN medicines m ON m.id = i.medicine_id WHERE i.pharmacy_id = ? AND m.is_active = 1 ORDER BY m.name`, [pharmacy.id]);
  res.json({ pharmacy, inventory });
});

router.get('/admin/accounts', authenticate, authorize('admin'), async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = 50;
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
  const [data] = await pool.query(`SELECT u.id, v.name, u.email, u.role,
    JSON_EXTRACT(u.payload, '$.isActive') AS is_active,
    JSON_UNQUOTE(JSON_EXTRACT(u.payload, '$.createdAt')) AS created_at
    FROM users u JOIN business_user_profiles v ON v.id = u.id ORDER BY u.id LIMIT ? OFFSET ?`, [limit, (page - 1) * limit]);
  res.json({ success: true, data, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
});
module.exports = router;
