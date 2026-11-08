const service = require('./medicines.service');
const { toInt, parseBool, parsePagination, parseLimit } = require('../../utils/helpers');

exports.list = async (req, res) => {
  const { q, category, ingredient, strength, prescription, sort } = req.query;
  const result = await service.list({
    q,
    category,
    ingredient,
    strength,
    prescription,
    sort,
    ...parsePagination(req.query),
  });
  res.json({ success: true, ...result });
};

exports.categories = async (req, res) => {
  res.json({ success: true, data: await service.categories() });
};

exports.getById = async (req, res) => {
  const data = await service.getById(toInt(req.params.id, 'id', { min: 1 }));
  res.json({ success: true, data });
};

// Thuoc thay the cung hoat chat (?same_strength=1 de chi lay cung ham luong)
exports.alternatives = async (req, res) => {
  const result = await service.alternatives(toInt(req.params.id, 'id', { min: 1 }), {
    sameStrengthOnly: parseBool(req.query.same_strength),
    limit: parseLimit(req.query.limit, 10, 30),
  });
  res.json({ success: true, ...result });
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
  res.json({ success: true, message: 'Da vo hieu hoa thuoc' });
};
