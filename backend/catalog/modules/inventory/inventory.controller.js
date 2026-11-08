const service = require('./inventory.service');
const { toInt, parseBool, parsePagination } = require('../../utils/helpers');

exports.listByPharmacy = async (req, res) => {
  const result = await service.listByPharmacy(toInt(req.params.pharmacyId, 'pharmacyId', { min: 1 }), {
    inStock: req.query.in_stock === '1',
    ...parsePagination(req.query),
  });
  res.json({ success: true, ...result });
};

exports.upsert = async (req, res) => {
  const data = await service.upsert(
    toInt(req.params.pharmacyId, 'pharmacyId', { min: 1 }),
    toInt(req.params.medicineId, 'medicineId', { min: 1 }),
    req.body || {}
  );
  res.json({ success: true, data });
};

exports.remove = async (req, res) => {
  await service.remove(
    toInt(req.params.pharmacyId, 'pharmacyId', { min: 1 }),
    toInt(req.params.medicineId, 'medicineId', { min: 1 })
  );
  res.json({ success: true, message: 'Da xoa thuoc khoi kho' });
};

exports.availability = async (req, res) => {
  const radiusKm = Math.min(Math.max(Number(req.query.radius_km) || 5, 0.1), 50);
  const data = await service.availability(toInt(req.params.medicineId, 'medicineId', { min: 1 }), {
    lat: req.query.lat,
    lng: req.query.lng,
    radiusKm,
    openNow: parseBool(req.query.open_now),
    at: req.query.at,
  });
  res.json({ success: true, data });
};
