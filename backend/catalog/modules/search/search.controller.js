const service = require('./search.service');
const { parseLimit } = require('../../utils/helpers');

// GET /api/search?q=an khang&lat=&lng=  -> o tim kiem chung: thuoc + nha thuoc (ten, dia chi, khu vuc)
exports.quick = async (req, res) => {
  const data = await service.quickSearch(req.query.q, {
    lat: req.query.lat,
    lng: req.query.lng,
    limit: parseLimit(req.query.limit, 5, 20),
  });
  res.json({ success: true, data });
};

// GET /api/search/medicines?q=para  -> goi y nhanh khi go ten thuoc
exports.suggest = async (req, res) => {
  const data = await service.suggestMedicines(req.query.q || '', parseLimit(req.query.limit, 8, 20));
  res.json({ success: true, data });
};

// POST /api/search/pharmacies  -> nha thuoc gan nhat con hang cho danh sach thuoc
exports.pharmacies = async (req, res) => {
  const result = await service.searchPharmacies(req.body || {});
  res.json({ success: true, ...result });
};
