const service = require('./pharmacies.service');
const { toInt, parseBool, parsePagination } = require('../../utils/helpers');

// ----- API cong khai: chi nha thuoc da duoc xac thuc -----

exports.list = async (req, res) => {
  const { q, district, at, sort } = req.query;
  const result = await service.list({
    q,
    district,
    at,
    sort,
    openNow: parseBool(req.query.open_now),
    ...parsePagination(req.query),
  });
  res.json({ success: true, ...result });
};

exports.nearby = async (req, res) => {
  const { q, district, at, sort } = req.query;
  const radiusKm = Math.min(Math.max(Number(req.query.radius_km) || 5, 0.1), 50);
  const result = await service.nearby({
    lat: req.query.lat,
    lng: req.query.lng,
    radiusKm,
    q,
    district,
    at,
    sort,
    openNow: parseBool(req.query.open_now),
    ...parsePagination(req.query),
  });
  res.json({ success: true, ...result });
};

exports.getById = async (req, res) => {
  const data = await service.getById(toInt(req.params.id, 'id', { min: 1 }), { publicOnly: true });
  res.json({ success: true, data });
};

exports.create = async (req, res) => {
  const data = await service.create(req.body);
  res.status(201).json({ success: true, data });
};

exports.update = async (req, res) => {
  const data = await service.update(toInt(req.params.id, 'id', { min: 1 }), req.body);
  res.json({ success: true, data });
};

exports.remove = async (req, res) => {
  await service.remove(toInt(req.params.id, 'id', { min: 1 }));
  res.json({ success: true, message: 'Da vo hieu hoa nha thuoc' });
};

// ----- API quan tri: di qua requireAdmin, thay duoc moi trang thai -----

exports.adminList = async (req, res) => {
  const { q, district, status, at, sort } = req.query;
  const result = await service.list({
    q,
    district,
    status,
    at,
    sort,
    admin: true,
    openNow: parseBool(req.query.open_now),
    ...parsePagination(req.query),
  });
  res.json({ success: true, ...result });
};

exports.adminGetById = async (req, res) => {
  const data = await service.getById(toInt(req.params.id, 'id', { min: 1 }));
  res.json({ success: true, data });
};

exports.setVerification = async (req, res) => {
  const data = await service.setVerification(toInt(req.params.id, 'id', { min: 1 }), (req.body || {}).status);
  res.json({ success: true, data });
};
