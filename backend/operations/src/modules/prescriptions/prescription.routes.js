const express = require('express');
const { authenticate, authorize } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { uploadPrescription } = require('../../middleware/upload');
const { z, idSchema, idParams, pagination } = require('../../utils/schemas');
const { STATUSES } = require('../../models/Prescription');
const service = require('./prescription.service');

const router = express.Router();
router.use(authenticate);

const listQuery = pagination.extend({ status: z.enum(STATUSES).optional() });

const itemsBody = z.object({
  items: z
    .array(
      z.object({
        drugId: idSchema.nullable().optional(),
        drugName: z.string().trim().min(1).max(200).optional(),
        strength: z.string().trim().max(50).optional(),
        quantity: z.number().int().min(1).max(1000),
        instructions: z.string().trim().max(500).optional(),
        rawText: z.string().max(500).optional(),
      }).refine((i) => i.drugId || i.drugName, { message: 'Cần drugId hoặc drugName' }),
    )
    .max(30),
});

// Tải ảnh/PDF đơn thuốc (multipart/form-data, field "file")
router.post('/', authorize('customer'), uploadPrescription, async (req, res) => {
  const doc = await service.create(req.user, req.file);
  res.status(202).json(doc);
});

router.get('/', authorize('customer', 'admin'), validate({ query: listQuery }), async (req, res) => {
  res.json(await service.list(req.user, req.valid.query));
});

router.get('/:id', validate({ params: idParams }), async (req, res) => {
  res.json(await service.get(req.user, req.valid.params.id));
});

// Xem file gốc — có kiểm tra quyền, không public
router.get('/:id/file', validate({ params: idParams }), async (req, res) => {
  const file = await service.getFile(req.user, req.valid.params.id);
  res.set('Cache-Control', 'private, no-store');
  res.type(file.mimeType);
  res.sendFile(file.path);
});

// Người dùng sửa/xóa các dòng OCR trước khi xác nhận
router.put(
  '/:id/items',
  authorize('customer'),
  validate({ params: idParams, body: itemsBody }),
  async (req, res) => {
    res.json(await service.updateItems(req.user, req.valid.params.id, req.valid.body.items));
  },
);

router.post('/:id/confirm', authorize('customer'), validate({ params: idParams }), async (req, res) => {
  res.json(await service.confirm(req.user, req.valid.params.id));
});

router.post('/:id/reprocess', authorize('customer'), validate({ params: idParams }), async (req, res) => {
  res.status(202).json(await service.reprocess(req.user, req.valid.params.id));
});

router.delete('/:id', authorize('customer'), validate({ params: idParams }), async (req, res) => {
  await service.remove(req.user, req.valid.params.id);
  res.status(204).end();
});

module.exports = router;
